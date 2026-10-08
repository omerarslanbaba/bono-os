"use strict";
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
function must(ok,msg){if(!ok)throw new Error(msg)}
function sha(file){return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}

const root=fs.mkdtempSync(path.join(os.tmpdir(),"bono-worker-case-guard-"));
process.env.BONO_DB_PATH=path.join(root,"bono.db");
process.env.USERPROFILE=root;
process.env.BONO_WORKER_TEST_MODE="1";
const db=require("../bridge/db");
const worker=require("../bridge/worker");

const desktop=path.join(root,"OneDrive","Masaüstü");
const archiveRoot=path.join(desktop,"Dava Dosyaları");
const downloads=path.join(root,"Downloads");
const caseA=path.join(archiveRoot,"Case-A"),caseB=path.join(archiveRoot,"Case-B");
for(const p of [downloads,caseA,caseB])fs.mkdirSync(p,{recursive:true});

function addCase(id,dirName){
  db.prepare("insert into cases(id,external_id,court,court_file_no,status,uyap_dosya_id) values(?,?,?,?,?,?)")
    .run(id,"uyap:guard:"+id,"Fixture Mahkemesi","2026/"+id,"open","DOSYA-"+id);
  const f=db.prepare("insert into archive_folders(root_path,relative_path,court_category,folder_name,file_count) values(?,?,?,?,0)")
    .run(archiveRoot,dirName,"Fixture",dirName);
  db.prepare("insert into archive_case_links(case_id,archive_folder_id,confidence,status,reasons_json) values(?,?,1,'verified','[]')")
    .run(id,Number(f.lastInsertRowid));
}
addCase(1,"Case-A");addCase(2,"Case-B");

function addDownload(caseId,remoteId,fileName,bytes){
  const src=path.join(downloads,fileName);fs.writeFileSync(src,bytes);
  const rd=db.prepare(`insert into uyap_remote_documents(case_id,remote_document_id,remote_title,document_type,document_date,original_file_name,status,metadata_json)
    values(?,?,?,?,?,?,'download_queued',?)`).run(
      caseId,"RID-"+remoteId,"Duruşma Zaptı","Duruşma Zaptı","2026-10-08",fileName,
      JSON.stringify({evrakId:"EVRAK-"+remoteId,dosyaId:"DOSYA-"+caseId,dosyaAdi:fileName})
    );
  const q=db.prepare(`insert into uyap_command_queue(command_type,endpoint_key,payload_json,status,result_meta_json,finished_at)
    values('download_document','document.pdf',?,'completed',?,datetime('now'))`).run(
      JSON.stringify({context:{caseId,remoteDocumentDbId:Number(rd.lastInsertRowid)}}),
      JSON.stringify({fileName,contentType:"application/pdf",size:bytes.length})
    );
  return {remoteDbId:Number(rd.lastInsertRowid),commandId:Number(q.lastInsertRowid),src};
}

(async()=>{
  const bytes=Buffer.from("%PDF-1.4\nSAME CASE-SCOPED HASH\n");
  const a=addDownload(1,1,"case-a.pdf",bytes);
  const ra=await worker.processJob({job_type:"ingest_uyap_download",payload:{commandId:a.commandId}});
  const rowA=db.prepare("select * from uyap_remote_documents where id=?").get(a.remoteDbId);
  must(rowA.status==="filed"&&rowA.filed_path&&path.resolve(rowA.filed_path).startsWith(path.resolve(caseA)),"case A was not filed into Case-A");

  const b=addDownload(2,2,"case-b.pdf",bytes);
  const rb=await worker.processJob({job_type:"ingest_uyap_download",payload:{commandId:b.commandId}});
  const rowB=db.prepare("select * from uyap_remote_documents where id=?").get(b.remoteDbId);
  must(rowB.status==="filed"&&rowB.filed_path&&path.resolve(rowB.filed_path).startsWith(path.resolve(caseB)),"same hash in case B reused wrong case canonical");
  must(path.resolve(rowA.filed_path)!==path.resolve(rowB.filed_path),"two cases share one canonical path");
  must(sha(rowA.filed_path)===sha(rowB.filed_path),"case-scoped copies changed content");

  const assetA=Number(rowA.local_asset_id),assetB=Number(rowB.local_asset_id);
  must(assetA===assetB,"same hash should remain one logical local_asset");
  const locs=db.prepare("select local_path from asset_locations where asset_id=? order by local_path").all(assetA).map(x=>path.resolve(x.local_path));
  must(locs.some(x=>x.startsWith(path.resolve(caseA)))&&locs.some(x=>x.startsWith(path.resolve(caseB))),"logical asset lacks canonical location in both cases");

  const again=path.join(root,"repeat.pdf");fs.writeFileSync(again,bytes);
  const repeat=await worker.archiveOneFile(again,1,"Duruşma Zaptı - 2026-10-08.pdf");
  must(repeat.archived&&repeat.dedup===true&&path.resolve(repeat.path)===path.resolve(rowA.filed_path),"same case reprocessing did not reuse its own canonical");

  const different=path.join(root,"different.pdf");fs.writeFileSync(different,Buffer.from("%PDF-1.4\nDIFFERENT\n"));
  const diff=await worker.archiveOneFile(different,1,path.basename(rowA.filed_path));
  must(diff.archived&&path.resolve(diff.path)!==path.resolve(rowA.filed_path),"different content overwrote existing canonical");
  must(fs.existsSync(rowA.filed_path),"existing canonical was damaged");

  console.log(JSON.stringify({
    ok:true,
    wrongCaseHashReusePrevented:true,
    caseACanonical:rowA.filed_path,
    caseBCanonical:rowB.filed_path,
    logicalAssetShared:assetA===assetB,
    canonicalLocations:locs.length,
    sameCaseIdempotent:repeat.dedup===true,
    sameNameDifferentContentSafe:true
  }));
  try{db.close()}catch{}
  fs.rmSync(root,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exitCode=1});
