"use strict";

const fs=require("fs");
const os=require("os");
const path=require("path");
const crypto=require("crypto");
const {spawnSync}=require("child_process");
const {DatabaseSync}=require("node:sqlite");

const ROOT=path.resolve(__dirname,"..");
const MIGRATION=path.join(ROOT,"scripts","asset46_metadata_migration.js");
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"bono-asset46-migration-selftest-"));
const dbPath=path.join(tmp,"fixture.db");
const downloads=path.join(tmp,"Downloads");
const archiveRoot=path.join(tmp,"Dava Dosyaları");
const targetDir=path.join(archiveRoot,"Asliye Hukuk Mahkemesi","Körfez 2. Asliye Hukuk Mahkemesi - 2026-218");
const source=path.join(downloads,"(2)CevapDilekcesi.pdf");
const target=path.join(targetDir,"Cevap Dilekçesi - 2026-09-14.pdf");
const snapshots=path.join(tmp,"snapshots");
fs.mkdirSync(downloads,{recursive:true});
fs.mkdirSync(targetDir,{recursive:true});

const bytes=Buffer.from("%PDF-1.4\nasset46 migration fixture\n");
fs.writeFileSync(source,bytes);
fs.writeFileSync(target,bytes);
const expected=crypto.createHash("sha256").update(bytes).digest("hex");

const db=new DatabaseSync(dbPath);
db.exec([
"CREATE TABLE local_assets(id INTEGER PRIMARY KEY,sha256 TEXT UNIQUE,file_name TEXT,extension TEXT,size_bytes INTEGER,mime_hint TEXT,first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,suggested_client_id INTEGER,suggested_office_file_id INTEGER,classification TEXT,indexed_text TEXT,original_extension TEXT,archive_extension TEXT,archive_policy TEXT,archive_path TEXT,source_container TEXT)",
"CREATE TABLE asset_locations(id INTEGER PRIMARY KEY,asset_id INTEGER NOT NULL,local_path TEXT NOT NULL UNIQUE,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,source_root TEXT)",
"CREATE TABLE uyap_remote_documents(id INTEGER PRIMARY KEY,case_id INTEGER,remote_document_id TEXT,remote_title TEXT,document_type TEXT,document_date TEXT,original_file_name TEXT,remote_hash TEXT,local_asset_id INTEGER,staging_path TEXT,filed_path TEXT,status TEXT,first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,downloaded_at TEXT,filed_at TEXT,is_baseline INTEGER DEFAULT 0,metadata_json TEXT)"
].join(";"));
db.prepare("INSERT INTO local_assets(id,sha256,file_name,extension,size_bytes,classification,original_extension,archive_extension,archive_policy,archive_path) VALUES(46,?,?,?,?,?,?,?,?,?)")
  .run(expected,path.basename(source),".pdf",bytes.length,"dilekce",".pdf",".pdf","keep_original",source);
db.prepare("INSERT INTO asset_locations(asset_id,local_path,source_root) VALUES(46,?,?)").run(source,downloads);
db.prepare("INSERT INTO uyap_remote_documents(id,case_id,remote_document_id,remote_title,document_type,original_file_name,local_asset_id,filed_path,status) VALUES(74,30,'fixture-remote','Cevap Dilekçesi','Cevap Dilekçesi',?,46,?,'filed')")
  .run(path.basename(source),source);
db.close();

function run(extra){
  const args=[
    MIGRATION,
    "--db",dbPath,
    "--source",source,
    "--target",target,
    "--archive-root",archiveRoot,
    "--expected-sha",expected,
    "--snapshot-dir",snapshots,
    ...extra
  ];
  const cp=spawnSync(process.execPath,args,{cwd:ROOT,encoding:"utf8",windowsHide:true,timeout:30000});
  const lines=String(cp.stdout||"").trim().split(/\r?\n/).filter(Boolean);
  let data=null;
  try{data=JSON.parse(lines.join("\n"))}catch{}
  return {status:cp.status,stdout:cp.stdout,stderr:cp.stderr,data};
}
function assert(cond,msg){if(!cond)throw new Error(msg)}

let result={ok:false};
try{
  const plan=run([]);
  assert(plan.status===0,"plan failed: "+(plan.stderr||plan.stdout));
  assert(plan.data?.readOnly===true&&plan.data?.mode==="plan","plan was not read-only");

  const apply=run(["--apply","--confirm","ASSET46_CANONICAL"]);
  assert(apply.status===0,"apply failed: "+(apply.stderr||apply.stdout));
  assert(apply.data?.ok===true&&apply.data?.sourceLocationPreserved===true&&apply.data?.canonicalLocationPresent===true,"apply verification failed");
  assert(fs.existsSync(source)&&fs.existsSync(target),"physical source/target missing after apply");

  let check=new DatabaseSync(dbPath,{readOnly:true});
  let locations=check.prepare("SELECT local_path FROM asset_locations WHERE asset_id=46 ORDER BY id").all().map(x=>path.resolve(x.local_path).toLowerCase());
  let remote=check.prepare("SELECT filed_path,status,local_asset_id FROM uyap_remote_documents WHERE id=74").get();
  let asset=check.prepare("SELECT archive_path,archive_policy FROM local_assets WHERE id=46").get();
  check.close();
  assert(locations.includes(path.resolve(source).toLowerCase())&&locations.includes(path.resolve(target).toLowerCase()),"apply did not preserve both locations");
  assert(path.resolve(remote.filed_path).toLowerCase()===path.resolve(target).toLowerCase()&&remote.status==="filed"&&Number(remote.local_asset_id)===46,"remote row not canonical after apply");
  assert(path.resolve(asset.archive_path).toLowerCase()===path.resolve(target).toLowerCase(),"asset archive_path not canonical after apply");

  const snapshotPath=apply.data.snapshotPath;
  assert(snapshotPath&&fs.existsSync(snapshotPath),"snapshot missing");
  const rollback=run(["--rollback",snapshotPath,"--confirm","ASSET46_ROLLBACK"]);
  assert(rollback.status===0,"rollback failed: "+(rollback.stderr||rollback.stdout));
  assert(rollback.data?.ok===true&&rollback.data?.physicalCanonicalPreserved===true,"rollback verification failed");

  check=new DatabaseSync(dbPath,{readOnly:true});
  locations=check.prepare("SELECT local_path FROM asset_locations WHERE asset_id=46 ORDER BY id").all().map(x=>path.resolve(x.local_path).toLowerCase());
  remote=check.prepare("SELECT filed_path,status,local_asset_id FROM uyap_remote_documents WHERE id=74").get();
  asset=check.prepare("SELECT archive_path,archive_policy FROM local_assets WHERE id=46").get();
  check.close();
  assert(locations.length===1&&locations[0]===path.resolve(source).toLowerCase(),"rollback did not restore original location set");
  assert(path.resolve(remote.filed_path).toLowerCase()===path.resolve(source).toLowerCase(),"rollback did not restore remote filed_path");
  assert(path.resolve(asset.archive_path).toLowerCase()===path.resolve(source).toLowerCase(),"rollback did not restore asset archive_path");
  assert(fs.existsSync(target),"rollback deleted canonical physical copy");

  result={
    ok:true,
    planReadOnly:true,
    applyVerified:true,
    sourcePreservedAfterApply:true,
    canonicalLocationAdded:true,
    snapshotCreated:true,
    rollbackVerified:true,
    canonicalPhysicalCopyPreservedAfterRollback:true
  };
}catch(e){
  result={ok:false,error:String(e.stack||e.message||e)};
  process.exitCode=1;
}finally{
  try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}
}
result.tempCleaned=!fs.existsSync(tmp);
console.log(JSON.stringify(result,null,2));
