"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {DatabaseSync}=require("node:sqlite");

function arg(name,fallback=null){const i=process.argv.indexOf(name);return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback}
const has=(name)=>process.argv.includes(name);
const USER=process.env.USERPROFILE||"C:\\Users\\omera";
const ROOT=path.resolve(__dirname,"..");
const DB_PATH=path.resolve(arg("--db",path.join(ROOT,"data","bono.db")));
const ASSET_ID=Number(arg("--asset-id","46"));
const REMOTE_ID=Number(arg("--remote-id","74"));
const SOURCE=path.resolve(arg("--source",path.join(USER,"Downloads","(2)CevapDilekcesi.pdf")));
const TARGET=path.resolve(arg("--target",path.join(USER,"OneDrive","Masaüstü","Dava Dosyaları","Asliye Hukuk Mahkemesi","Körfez 2. Asliye Hukuk Mahkemesi - 2026-218","Cevap Dilekçesi - 2026-09-14.pdf")));
const ARCHIVE_ROOT=path.resolve(arg("--archive-root",path.join(USER,"OneDrive","Masaüstü","Dava Dosyaları")));
const EXPECTED=String(arg("--expected-sha","5c620fb763693933fc27cab5c56141eb8f20d57360f9534338427aa7d6357a0c")).toLowerCase();
const APPLY=has("--apply");
const ROLLBACK=arg("--rollback",null);
const CONFIRM=arg("--confirm","");
const SNAPSHOT_DIR=path.resolve(arg("--snapshot-dir",path.join(ROOT,"data","backups")));

function exists(p){try{return fs.existsSync(p)}catch{return false}}
function sha(file){const h=crypto.createHash("sha256"),fd=fs.openSync(file,"r"),buf=Buffer.allocUnsafe(1024*1024);try{let n=0,pos=0;do{n=fs.readSync(fd,buf,0,buf.length,pos);if(n){h.update(buf.subarray(0,n));pos+=n}}while(n)}finally{fs.closeSync(fd)}return h.digest("hex")}
function fileState(p){if(!exists(p))return {path:p,exists:false};const st=fs.statSync(p);return {path:p,exists:true,size:st.size,sha256:sha(p)}}
function rowState(db){
  return {
    asset:db.prepare("SELECT * FROM local_assets WHERE id=?").get(ASSET_ID)||null,
    remote:db.prepare("SELECT * FROM uyap_remote_documents WHERE id=?").get(REMOTE_ID)||null,
    locations:db.prepare("SELECT * FROM asset_locations WHERE asset_id=? ORDER BY id").all(ASSET_ID)
  };
}
function verifyIdentity(state){
  if(!state.asset)throw new Error("Asset not found: "+ASSET_ID);
  if(!state.remote)throw new Error("Remote document not found: "+REMOTE_ID);
  if(Number(state.remote.local_asset_id||0)!==ASSET_ID)throw new Error("Remote document does not reference expected asset");
  const dbSha=String(state.asset.sha256||"").toLowerCase();
  if(dbSha!==EXPECTED)throw new Error("DB asset SHA-256 differs from expected value");
}
function verifyFiles(){
  const source=fileState(SOURCE),target=fileState(TARGET);
  if(!source.exists)throw new Error("Source file missing");
  if(!target.exists)throw new Error("Canonical target missing");
  if(source.sha256!==EXPECTED)throw new Error("Source SHA-256 mismatch");
  if(target.sha256!==EXPECTED)throw new Error("Target SHA-256 mismatch");
  if(source.size!==target.size)throw new Error("Source/target size mismatch");
  return {source,target,hashMatch:true,sizeMatch:true};
}
function print(obj){console.log(JSON.stringify(obj,null,2))}
function safeStamp(){return new Date().toISOString().replace(/[:.]/g,"-")}

if(APPLY&&ROLLBACK)throw new Error("Choose either --apply or --rollback");
const writeMode=APPLY||!!ROLLBACK;
const db=new DatabaseSync(DB_PATH,{readOnly:!writeMode});
const before=rowState(db);
verifyIdentity(before);
const files=verifyFiles();

const plan={
  mode:APPLY?"apply":ROLLBACK?"rollback":"plan",
  readOnly:!writeMode,
  dbPath:DB_PATH,
  assetId:ASSET_ID,
  remoteDocumentId:REMOTE_ID,
  expectedSha256:EXPECTED,
  source:files.source,
  canonical:files.target,
  before,
  operations:[
    "preserve existing Downloads asset_location",
    "add/reuse canonical asset_location for the same asset",
    "set local_assets.archive_path to canonical target",
    "keep original/archive extension as .pdf and archive_policy=keep_original",
    "set uyap_remote_documents.filed_path to canonical target while retaining local_asset_id",
    "verify post-migration DB state and physical SHA-256"
  ],
  rollbackPolicy:[
    "restore asset and remote row fields from JSON snapshot",
    "remove canonical asset_location only if it did not exist before migration",
    "never delete source Downloads file",
    "never delete canonical physical file during metadata rollback"
  ]
};

if(!writeMode){
  print(plan);
  db.close();
  process.exit(0);
}

if(APPLY){
  if(CONFIRM!=="ASSET46_CANONICAL")throw new Error("Apply blocked: use --confirm ASSET46_CANONICAL");
  fs.mkdirSync(SNAPSHOT_DIR,{recursive:true});
  const snapshotPath=path.join(SNAPSHOT_DIR,"asset46-metadata-"+safeStamp()+".json");
  const snapshot={version:1,createdAt:new Date().toISOString(),dbPath:DB_PATH,assetId:ASSET_ID,remoteDocumentId:REMOTE_ID,source:SOURCE,target:TARGET,expectedSha256:EXPECTED,before};
  fs.writeFileSync(snapshotPath,JSON.stringify(snapshot,null,2),"utf8");

  db.exec("BEGIN IMMEDIATE");
  try{
    const occupied=db.prepare("SELECT asset_id FROM asset_locations WHERE local_path=?").get(TARGET);
    if(occupied&&Number(occupied.asset_id)!==ASSET_ID)throw new Error("Canonical path already belongs to another asset");

    db.prepare("INSERT INTO asset_locations(asset_id,local_path,source_root,last_seen_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(local_path) DO UPDATE SET asset_id=excluded.asset_id,source_root=excluded.source_root,last_seen_at=datetime('now')")
      .run(ASSET_ID,TARGET,ARCHIVE_ROOT);
    db.prepare("UPDATE local_assets SET archive_path=?,original_extension=COALESCE(original_extension,'.pdf'),archive_extension='.pdf',archive_policy='keep_original',last_seen_at=datetime('now') WHERE id=?")
      .run(TARGET,ASSET_ID);
    db.prepare("UPDATE uyap_remote_documents SET local_asset_id=?,filed_path=?,status='filed',staging_path=NULL,filed_at=COALESCE(filed_at,datetime('now')),last_seen_at=datetime('now') WHERE id=?")
      .run(ASSET_ID,TARGET,REMOTE_ID);
    db.exec("COMMIT");
  }catch(e){
    db.exec("ROLLBACK");
    throw e;
  }
  const after=rowState(db);
  verifyIdentity(after);
  const postFiles=verifyFiles();
  const sourceStill=after.locations.some(x=>path.resolve(x.local_path).toLowerCase()===SOURCE.toLowerCase());
  const canonicalLoc=after.locations.some(x=>path.resolve(x.local_path).toLowerCase()===TARGET.toLowerCase());
  if(!sourceStill)throw new Error("Source asset_location was lost");
  if(!canonicalLoc)throw new Error("Canonical asset_location missing after apply");
  if(path.resolve(after.remote.filed_path).toLowerCase()!==TARGET.toLowerCase())throw new Error("Remote filed_path did not move to canonical target");
  print({ok:true,mode:"apply",snapshotPath,files:postFiles,sourceLocationPreserved:sourceStill,canonicalLocationPresent:canonicalLoc,after});
  db.close();
  process.exit(0);
}

if(ROLLBACK){
  if(CONFIRM!=="ASSET46_ROLLBACK")throw new Error("Rollback blocked: use --confirm ASSET46_ROLLBACK");
  const snapshot=JSON.parse(fs.readFileSync(path.resolve(ROLLBACK),"utf8"));
  if(Number(snapshot.assetId)!==ASSET_ID||Number(snapshot.remoteDocumentId)!==REMOTE_ID)throw new Error("Snapshot identity mismatch");
  if(String(snapshot.expectedSha256||"").toLowerCase()!==EXPECTED)throw new Error("Snapshot SHA mismatch");
  const old=snapshot.before;
  if(!old?.asset||!old?.remote||!Array.isArray(old.locations))throw new Error("Invalid snapshot");

  db.exec("BEGIN IMMEDIATE");
  try{
    const hadTarget=old.locations.some(x=>path.resolve(x.local_path).toLowerCase()===TARGET.toLowerCase());
    if(!hadTarget)db.prepare("DELETE FROM asset_locations WHERE asset_id=? AND local_path=?").run(ASSET_ID,TARGET);

    const a=old.asset;
    db.prepare("UPDATE local_assets SET file_name=?,extension=?,size_bytes=?,mime_hint=?,last_seen_at=?,suggested_client_id=?,suggested_office_file_id=?,classification=?,indexed_text=?,original_extension=?,archive_extension=?,archive_policy=?,archive_path=?,source_container=? WHERE id=?")
      .run(a.file_name,a.extension,a.size_bytes,a.mime_hint,a.last_seen_at,a.suggested_client_id,a.suggested_office_file_id,a.classification,a.indexed_text,a.original_extension,a.archive_extension,a.archive_policy,a.archive_path,a.source_container,ASSET_ID);

    const r=old.remote;
    db.prepare("UPDATE uyap_remote_documents SET local_asset_id=?,staging_path=?,filed_path=?,status=?,remote_hash=?,downloaded_at=?,filed_at=?,last_seen_at=? WHERE id=?")
      .run(r.local_asset_id,r.staging_path,r.filed_path,r.status,r.remote_hash,r.downloaded_at,r.filed_at,r.last_seen_at,REMOTE_ID);
    db.exec("COMMIT");
  }catch(e){
    db.exec("ROLLBACK");
    throw e;
  }
  const after=rowState(db);
  print({ok:true,mode:"rollback",physicalCanonicalPreserved:exists(TARGET),after});
  db.close();
}
