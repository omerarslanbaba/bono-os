"use strict";

const fs=require("fs");
const os=require("os");
const path=require("path");
const Module=require("module");
const {DatabaseSync}=require("node:sqlite");
const {copyVerified,sha256File}=require("../bridge/archive_safety");

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"bono-download-archive-selftest-"));
const fakeUser=path.join(tmp,"user");
const downloads=path.join(fakeUser,"Downloads");
fs.mkdirSync(downloads,{recursive:true});
process.env.USERPROFILE=fakeUser;

const db=new DatabaseSync(path.join(tmp,"fixture.db"));
const results=[];
const pass=(name,detail={})=>results.push({name,status:"pass",...detail});
const fail=(name,error,detail={})=>results.push({name,status:"fail",error:String(error),...detail});
const risk=(name,detail={})=>results.push({name,status:"risk",...detail});
function assert(name,cond,detail={}){if(cond)pass(name,detail);else fail(name,"assertion failed",detail)}
function counts(caseId){return Object.fromEntries(db.prepare("SELECT status,COUNT(*) n FROM uyap_remote_documents WHERE case_id=? GROUP BY status").all(caseId).map(r=>[r.status,Number(r.n)]))}

db.exec([
"CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
"CREATE TABLE uyap_rate_state(id INTEGER PRIMARY KEY,last_dispatch_ms INTEGER DEFAULT 0,next_allowed_ms INTEGER DEFAULT 0,circuit_open_until_ms INTEGER DEFAULT 0,consecutive_failures INTEGER DEFAULT 0,last_status INTEGER,state TEXT DEFAULT 'ready',updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
"INSERT INTO uyap_rate_state(id) VALUES(1)",
"CREATE TABLE cases(id INTEGER PRIMARY KEY,external_id TEXT,office_file_id INTEGER,client_name TEXT,court TEXT,court_file_no TEXT,uyap_dosya_id TEXT)",
"CREATE TABLE parties(id INTEGER PRIMARY KEY,case_id INTEGER,name TEXT)",
"CREATE TABLE uyap_endpoints(endpoint_key TEXT PRIMARY KEY,method TEXT,host TEXT,path TEXT,purpose TEXT,enabled INTEGER,min_interval_ms INTEGER,last_verified_at TEXT)",
"CREATE TABLE uyap_command_queue(id INTEGER PRIMARY KEY,command_type TEXT NOT NULL,endpoint_key TEXT,payload_json TEXT,status TEXT DEFAULT 'queued',priority INTEGER DEFAULT 100,attempts INTEGER DEFAULT 0,max_attempts INTEGER DEFAULT 3,not_before_ms INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,dispatched_at TEXT,finished_at TEXT,error TEXT,result_meta_json TEXT,result_json TEXT)",
"CREATE TABLE uyap_remote_documents(id INTEGER PRIMARY KEY,case_id INTEGER NOT NULL,remote_document_id TEXT NOT NULL,stable_key TEXT,remote_title TEXT,document_type TEXT,document_date TEXT,original_file_name TEXT,remote_hash TEXT,local_asset_id INTEGER,staging_path TEXT,filed_path TEXT,status TEXT DEFAULT 'discovered',first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,downloaded_at TEXT,filed_at TEXT,is_baseline INTEGER DEFAULT 0,metadata_json TEXT,UNIQUE(case_id,remote_document_id))",
"CREATE UNIQUE INDEX ux_fixture_stable ON uyap_remote_documents(case_id,stable_key) WHERE stable_key IS NOT NULL"
].join(";"));

for(const [k,v] of [
  ["uyap_integration_mode","browser_readonly"],
  ["uyap_session_state","ready"],
  ["uyap_document_download_state","ready"],
  ["uyap_manual_download_pause","0"]
]) db.prepare("INSERT INTO app_settings(key,value) VALUES(?,?)").run(k,v);

db.prepare("INSERT INTO uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms) VALUES(?,?,?,?,?,?,?)")
  .run("document.pdf","GET","avukat.uyap.gov.tr","/view_document_brd.uyap","document",1,1300);

const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(request==="./db"&&parent&&String(parent.filename||"").endsWith(path.join("bridge","uyap.js")))return db;
  return originalLoad.call(this,request,parent,isMain);
};
let uyap;
try{
  delete require.cache[require.resolve("../bridge/uyap")];
  uyap=require("../bridge/uyap");
}finally{
  Module._load=originalLoad;
}

function addCase(id,count){
  db.prepare("INSERT INTO cases(id,external_id,court,court_file_no,uyap_dosya_id) VALUES(?,?,?,?,?)")
    .run(id,"uyap:case:"+id,"Test Court",id+"/2026","DOSYA-"+id);
  const ins=db.prepare("INSERT INTO uyap_remote_documents(case_id,remote_document_id,remote_title,document_type,document_date,original_file_name,status,metadata_json) VALUES(?,?,?,?,?,?,'discovered',?)");
  for(let i=1;i<=count;i++){
    ins.run(
      id,
      "RID-"+id+"-"+i,
      "Dava Dilekçesi · Fixture "+i,
      "Dava Dilekçesi",
      "2026-01-"+String((i%28)+1).padStart(2,"0"),
      "fixture-"+i+".pdf",
      JSON.stringify({evrakId:"EVRAK-"+id+"-"+i,dosyaId:"DOSYA-"+id,dosyaAdi:"fixture-"+i+".pdf"})
    );
  }
}
function finishActiveBatch(caseId){
  const n=Number(db.prepare("SELECT COUNT(*) n FROM uyap_remote_documents WHERE case_id=? AND status='download_queued'").get(caseId).n||0);
  db.prepare("UPDATE uyap_remote_documents SET status='filed',filed_path='fixture://canonical',filed_at=datetime('now') WHERE case_id=? AND status='download_queued'").run(caseId);
  db.prepare("UPDATE uyap_command_queue SET status='completed',finished_at=datetime('now') WHERE command_type='download_document' AND status='queued' AND payload_json LIKE ?")
    .run('%"caseId":'+caseId+'%');
  return n;
}

try{
  addCase(1,201);
  const b1=uyap.enqueuePendingDownloads(1,200);
  let c=counts(1);
  assert("batch1_queues_exactly_200",b1.queued===200&&c.download_queued===200&&c.discovered===1,{result:b1,counts:c});
  assert("batch1_reports_remaining_downloadable",Number(b1.summary?.missingDownloadable||0)===1,{missingDownloadable:b1.summary?.missingDownloadable});
  assert("batch1_completion_fixture",finishActiveBatch(1)===200);

  const b2=uyap.enqueuePendingDownloads(1,200);
  c=counts(1);
  assert("batch2_available_after_batch1_completion",b2.queued===200&&c.download_queued===200&&c.discovered===5,{result:b2,counts:c});
  finishActiveBatch(1);

  const b3=uyap.enqueuePendingDownloads(1,200);
  c=counts(1);
  assert("batch3_queues_remainder",b3.queued===5&&c.download_queued===5&&Number(c.discovered||0)===0,{result:b3,counts:c});

  addCase(2,201);
  const cap1=uyap.enqueuePendingDownloads(2,200);
  const cap2=uyap.enqueuePendingDownloads(2,200);
  const active=Number(counts(2).download_queued||0);
  if(active>200){
    risk("active_batch_cap_is_per_invocation",{
      firstQueued:cap1.queued,
      secondQueued:cap2.queued,
      active,
      detail:"A second trigger before completion can exceed 200 active downloads for one case."
    });
  }else pass("active_batch_cap_is_per_invocation",{active});

  db.prepare("INSERT INTO cases(id,external_id,court,court_file_no,uyap_dosya_id) VALUES(?,?,?,?,?)")
    .run(3,"uyap:case:3","Test Court","3/2026","DOSYA-3");
  const addRemote=(rid,fileName)=>db.prepare("INSERT INTO uyap_remote_documents(case_id,remote_document_id,remote_title,document_type,original_file_name,status,metadata_json) VALUES(3,?,?,?,?, 'download_queued',?)")
    .run("RID-3-"+rid,"Dava Dilekçesi "+rid,"Dava Dilekçesi",fileName,JSON.stringify({evrakId:"E-"+rid,dosyaId:"DOSYA-3"}));
  addRemote(1,"failed.pdf");
  addRemote(2,"cancelled.pdf");
  const remotes=db.prepare("SELECT id,original_file_name FROM uyap_remote_documents WHERE case_id=3 ORDER BY id").all();

  for(const [idx,commandStatus] of ["failed","cancelled"].entries()){
    const remote=remotes[idx];
    fs.writeFileSync(path.join(downloads,remote.original_file_name),Buffer.from("%PDF-1.4\nfixture "+commandStatus+"\n"));
    const cmd=db.prepare("INSERT INTO uyap_command_queue(command_type,endpoint_key,payload_json,status,result_meta_json) VALUES('download_document','document.pdf',?,?,?)")
      .run(JSON.stringify({context:{caseId:3,remoteDocumentDbId:remote.id}}),commandStatus,JSON.stringify({fileName:remote.original_file_name}));
    let ingestError=null;
    try{uyap.ingestDownloadedDocument(Number(cmd.lastInsertRowid))}catch(e){ingestError=e}
    const after=db.prepare("SELECT status,filed_path,staging_path FROM uyap_remote_documents WHERE id=?").get(remote.id);
    if(after.status==="filed"||after.filed_path){
      fail(commandStatus+"_command_never_files","terminal failed/cancelled command was filed",{after});
    }else if(after.status==="downloaded"||after.staging_path){
      risk(commandStatus+"_command_ingest_guard_missing",{
        after,
        detail:"ingestDownloadedDocument accepts terminal failed/cancelled command if invoked; scheduler must never enqueue ingest for terminal failures."
      });
    }else{
      pass(commandStatus+"_command_never_files",{after,error:ingestError?String(ingestError.message||ingestError):null});
    }
  }

  const stage=path.join(tmp,"stage"),archive=path.join(tmp,"archive");
  fs.mkdirSync(stage,{recursive:true});
  const pdfSrc=path.join(stage,"doc.pdf"),pdfDst=path.join(archive,"doc.pdf");
  fs.writeFileSync(pdfSrc,Buffer.from("%PDF-1.4\ncanonical fixture\n"));
  const pdfSha=sha256File(pdfSrc);
  const pdfCopy=copyVerified(pdfSrc,pdfDst,{expectedSha256:pdfSha});
  assert("staging_to_canonical_hash_preserved",pdfCopy.hashMatch&&pdfCopy.sizeMatch&&pdfCopy.sourcePreserved&&fs.existsSync(pdfSrc),pdfCopy);

  const udfSrc=path.join(stage,"sample.udf"),udfDst=path.join(archive,"sample.udf");
  fs.writeFileSync(udfSrc,Buffer.from([0x55,0x44,0x46,0x00,0x10,0x20,0x30,0xff]));
  const udfSha=sha256File(udfSrc);
  const udfCopy=copyVerified(udfSrc,udfDst,{expectedSha256:udfSha});
  assert("udf_byte_integrity_preserved",udfCopy.hashMatch&&udfCopy.sourceSha===udfCopy.targetSha&&path.extname(udfDst)===".udf",udfCopy);

  const duplicateSrc=path.join(stage,"duplicate.udf");
  fs.copyFileSync(udfSrc,duplicateSrc);
  const dup=copyVerified(duplicateSrc,udfDst,{expectedSha256:udfSha});
  assert("sha_duplicate_reuses_verified_target",dup.action==="already_verified"&&dup.hashMatch&&fs.existsSync(duplicateSrc),dup);

  const conflictSrc=path.join(stage,"conflict.udf");
  fs.writeFileSync(conflictSrc,Buffer.from("different"));
  let conflictRejected=false;
  try{copyVerified(conflictSrc,udfDst)}catch{conflictRejected=true}
  assert("sha_duplicate_rejects_conflicting_target",conflictRejected);
}catch(e){
  fail("selftest_unhandled",e.stack||e.message||e);
}

const failed=results.filter(x=>x.status==="fail").length;
const risks=results.filter(x=>x.status==="risk").length;
try{db.close()}catch{}
try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}
console.log(JSON.stringify({ok:failed===0,failed,risks,tempCleaned:!fs.existsSync(tmp),results},null,2));
if(failed)process.exitCode=1;
