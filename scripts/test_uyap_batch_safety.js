const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawn}=require("node:child_process");

function must(ok,msg){if(!ok)throw new Error(msg)}
function tempRoot(){return fs.mkdtempSync(path.join(os.tmpdir(),"bono-uyap-batch-"))}
function freshModules(){
  for(const p of ["../bridge/uyap","../bridge/db"]){
    try{delete require.cache[require.resolve(p)]}catch{}
  }
  return {db:require("../bridge/db"),uyap:require("../bridge/uyap")};
}
function seed(db,count=201,caseId=1){
  db.prepare("insert or replace into app_settings(key,value) values('uyap_integration_mode','browser_readonly')").run();
  db.prepare("insert or replace into app_settings(key,value) values('uyap_session_state','ready')").run();
  db.prepare("insert or replace into app_settings(key,value) values('uyap_manual_download_pause','1')").run();
  db.prepare("insert or replace into app_settings(key,value) values('uyap_manual_download_reason','per_file_download_mode')").run();
  db.prepare("insert or replace into app_settings(key,value) values('uyap_document_download_state','paused_manual')").run();
  db.prepare(`insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms)
    values('document.pdf','GET','vatandas.uyap.gov.tr','/view_document_brd.uyap','download',1,1300)`).run();
  db.prepare(`insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms)
    values('case.search','POST','avukat.uyap.gov.tr','/avukat_mahkemeleri_sorgula.ajx','query',1,1300)`).run();
  db.prepare(`insert into cases(id,external_id,court,court_file_no,status,uyap_dosya_id)
    values(?,?,?,?,?,?)`).run(caseId,"uyap:test:"+caseId,"Test Mahkemesi","2026/1","open","DOSYA-"+caseId);
  const ins=db.prepare(`insert into uyap_remote_documents
    (id,case_id,remote_document_id,remote_title,document_type,document_date,original_file_name,status,metadata_json,stable_key)
    values(?,?,?,?,?,?,?,?,?,?)`);
  for(let i=1;i<=count;i++){
    ins.run(i,caseId,"EVRAK-"+i,"Duruşma Zaptı "+i,"Duruşma Zaptı","2026-10-08","evrak-"+i+".pdf","discovered",
      JSON.stringify({evrakId:"TOKEN-E-"+i,dosyaId:"DOSYA-"+caseId,dosyaAdi:"evrak-"+i+".pdf"}),"stable-"+i);
  }
}
function activeRows(db,caseId){
  return Number(db.prepare(`select count(*) n from uyap_command_queue
    where command_type='download_document' and status in ('queued','running')
      and json_valid(payload_json)=1
      and cast(json_extract(payload_json,'$.context.caseId') as integer)=?`).get(caseId).n||0);
}
function childBatch(script,dbPath,caseId){
  return new Promise((resolve,reject)=>{
    const cp=spawn(process.execPath,[script,"--child",dbPath,String(caseId)],{
      env:{...process.env,BONO_DB_PATH:dbPath},stdio:["ignore","pipe","pipe"]
    });
    let out="",err="";
    cp.stdout.on("data",d=>out+=d);cp.stderr.on("data",d=>err+=d);
    cp.on("exit",code=>code===0?resolve(JSON.parse(out.trim().split(/\r?\n/).pop())):reject(new Error(err||out||("child exit "+code))));
  });
}
async function main(){
  if(process.argv[2]==="--child"){
    process.env.BONO_DB_PATH=process.argv[3];
    const {uyap}=freshModules();
    const out=uyap.enqueuePendingDownloads(Number(process.argv[4]),200);
    console.log(JSON.stringify({queued:out.queued,activeAfter:out.activeAfter}));
    return;
  }

  const root=tempRoot(),dbPath=path.join(root,"bono.db");
  process.env.BONO_DB_PATH=dbPath;
  process.env.USERPROFILE=root;
  fs.mkdirSync(path.join(root,"Downloads"),{recursive:true});
  const {db,uyap}=freshModules();
  seed(db,201,1);

  // Prefix regression: 201 documents must fill exactly 200 slots.
  const first=uyap.enqueuePendingDownloads(1,200);
  must(first.queued===200,"201 fixture first batch expected 200, got "+first.queued);
  must(first.activeAfter===200,"first batch active expected 200, got "+first.activeAfter);
  must(activeRows(db,1)===200,"DB active count after first batch is not 200");

  // While first batch is active, another request must not exceed 200.
  const blocked=uyap.enqueuePendingDownloads(1,200);
  must(blocked.queued===0,"second call during active batch queued "+blocked.queued);
  must(blocked.activeAfter===200,"active total exceeded/changed from 200");
  must(activeRows(db,1)===200,"DB active total exceeded 200");

  // Finish first batch, then remaining one document must form the next batch.
  db.prepare("update uyap_command_queue set status='completed',finished_at=datetime('now') where command_type='download_document' and status in ('queued','running')").run();
  const second=uyap.enqueuePendingDownloads(1,200);
  must(second.queued===1,"remaining batch expected 1, got "+second.queued);
  must(second.activeAfter===1,"remaining active expected 1, got "+second.activeAfter);

  // Prefix duplicate exactness: remote id 2 must not collide with 20/200.
  const payloads=db.prepare(`select cast(json_extract(payload_json,'$.context.remoteDocumentDbId') as integer) rid
    from uyap_command_queue where command_type='download_document'`).all().map(x=>Number(x.rid));
  must(new Set(payloads).size===201,"not all 201 remote document ids received a command");

  // Cancelled/failed direct ingest must fail before touching staging/canonical state.
  for(const status of ["cancelled","failed"]){
    const remoteId=status==="cancelled"?1001:1002;
    db.prepare(`insert into uyap_remote_documents
      (id,case_id,remote_document_id,remote_title,document_type,original_file_name,status,metadata_json,stable_key)
      values(?,?,?,?,?,?,?,?,?)`).run(remoteId,1,"ING-"+status,"Duruşma Zaptı","Duruşma Zaptı",status+".pdf","discovered",
        JSON.stringify({evrakId:"ING-E-"+status,dosyaId:"DOSYA-1",dosyaAdi:status+".pdf"}),"ing-"+status);
    const fileName=status+".pdf";
    fs.writeFileSync(path.join(root,"Downloads",fileName),Buffer.from("%PDF-1.4\nfixture"));
    const q=db.prepare(`insert into uyap_command_queue(command_type,endpoint_key,payload_json,status,result_meta_json)
      values('download_document','document.pdf',?,?,?)`).run(
        JSON.stringify({context:{caseId:1,remoteDocumentDbId:remoteId}}),status,JSON.stringify({fileName,contentType:"application/pdf"})
      );
    let threw=false;
    try{uyap.ingestDownloadedDocument(Number(q.lastInsertRowid))}catch(e){
      threw=true;
      must(String(e.message).includes("completed"),status+" ingest rejected for wrong reason: "+e.message);
    }
    must(threw,status+" ingest did not throw");
    const rd=db.prepare("select staging_path,filed_path,local_asset_id,status from uyap_remote_documents where id=?").get(remoteId);
    must(!rd.staging_path&&!rd.filed_path&&!rd.local_asset_id,status+" ingest mutated staging/filed state");
    must(rd.status==="discovered",status+" ingest changed remote status");
  }

  // Manual download pause remains active, while query lane can still claim work.
  must(uyap.sessionState().manualDownloadPaused===true,"manual download pause was cleared");
  uyap.enqueue({commandType:"fetch_json",endpointKey:"case.search",payload:{query:{},body:{},context:{fixture:true}},priority:20});
  const query=uyap.claimNext("avukat.uyap.gov.tr","query");
  must(query&&query.commandType==="fetch_json","query lane could not claim during manual download pause");
  const download=uyap.claimNext("vatandas.uyap.gov.tr","download");
  must(!download||download.wait===true,"download lane claimed work despite manual pause");

  // True race test against a separate temp DB and two Node processes.
  const raceRoot=tempRoot(),raceDb=path.join(raceRoot,"bono.db");
  process.env.BONO_DB_PATH=raceDb;
  for(const p of ["../bridge/uyap","../bridge/db"]){try{delete require.cache[require.resolve(p)]}catch{}}
  const race=require("../bridge/db"); seed(race,201,1); race.close();
  const [ra,rb]=await Promise.all([childBatch(__filename,raceDb,1),childBatch(__filename,raceDb,1)]);
  process.env.BONO_DB_PATH=dbPath;
  const {DatabaseSync}=require("node:sqlite");
  const verify=new DatabaseSync(raceDb,{readOnly:true});
  const raceActive=activeRows(verify,1);
  verify.close();
  must(raceActive===200,"concurrent requests produced active="+raceActive);
  must(ra.queued+rb.queued===200,"concurrent requests queued total "+(ra.queued+rb.queued));

  console.log(JSON.stringify({
    ok:true,
    firstBatch:first.queued,
    duringActiveBatch:blocked.queued,
    secondBatch:second.queued,
    activeCap:200,
    exactRemoteIds:new Set(payloads).size,
    cancelledFailedIngestBlocked:true,
    manualDownloadPausePreserved:true,
    queryLaneDuringPause:true,
    concurrentQueuedTotal:ra.queued+rb.queued,
    concurrentActiveTotal:raceActive
  }));
}
main().catch(e=>{console.error(e);process.exitCode=1});
