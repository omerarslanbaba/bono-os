const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const http=require("node:http");
function must(ok,msg){if(!ok)throw new Error(msg)}

const root=fs.mkdtempSync(path.join(os.tmpdir(),"bono-webview-contract-"));
process.env.BONO_DB_PATH=path.join(root,"bono.db");
process.env.USERPROFILE=root;
const db=require("../bridge/db");
const uyap=require("../bridge/uyap");

function setting(k,v){db.prepare("insert into app_settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value").run(k,v)}
function addCase(id,dosyaId){
  db.prepare("insert into cases(id,external_id,court,court_file_no,status,uyap_dosya_id) values(?,?,?,?,?,?)")
    .run(id,"uyap:contract:"+id,"Fixture Mahkemesi","2026/"+id,"open",dosyaId);
}
setting("uyap_integration_mode","browser_readonly");
setting("uyap_session_state","ready");
setting("uyap_manual_download_pause","1");
setting("uyap_document_download_state","paused_manual");
db.prepare(`insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms)
 values('document.list','POST','avukat.uyap.gov.tr','/list_dosya_evraklar.ajx','docs',1,0)`).run();
db.prepare(`insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms)
 values('case.search','POST','avukat.uyap.gov.tr','/search_phrase_detayli.ajx','search',1,3000)`).run();
addCase(1,"DOSYA-1"); addCase(2,"DOSYA-2"); addCase(3,"DOSYA-3"); addCase(4,"DOSYA-4"); addCase(5,"DOSYA-5");

function responseJson(res,status,obj){res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(obj))}
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,"http://127.0.0.1");
  let m=u.pathname.match(/^\/api\/uyap\/cases\/(\d+)\/document-sync-status$/);
  if(req.method==="GET"&&m)return responseJson(res,200,uyap.caseDocumentSyncStatus(Number(m[1])));
  if(req.method==="GET"&&u.pathname==="/api/uyap/case-search-schema")return responseJson(res,200,uyap.caseSearchSchemaStatus());
  if(req.method==="POST"&&(m=u.pathname.match(/^\/api\/uyap\/cases\/(\d+)\/sync-documents$/))){
    const caseId=Number(m[1]),before=uyap.caseDocumentSyncStatus(caseId);
    if(before.sessionState==="login_required")return responseJson(res,409,{error:"UYAP oturumu gerekli.",sync:before});
    const id=uyap.enqueueCaseDocumentSync(caseId,{priority:6,purpose:"manual_case_sync",source:"contract_test"});
    return responseJson(res,202,{ok:true,accepted:true,id,commandId:Number(id),sync:uyap.caseDocumentSyncStatus(caseId)});
  }
  responseJson(res,404,{error:"not found"});
});

(async()=>{
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve)});
  const port=server.address().port,base="http://127.0.0.1:"+port;
  const get=async p=>{const r=await fetch(base+p);return {status:r.status,json:await r.json()}};
  const post=async p=>{const r=await fetch(base+p,{method:"POST"});return {status:r.status,json:await r.json()}};

  let r=await get("/api/uyap/case-search-schema");
  must(r.status===200&&r.json.contractVersion==="uyap.case-search-schema.v1","schema contract version");
  must(r.json.state==="observation_required"&&r.json.observed===false,"schema must fail closed without observation");
  must(r.json.targetedSearch.ready===false&&r.json.liveQueryRequired===true,"targeted search must stay disabled");

  r=await get("/api/uyap/cases/1/document-sync-status");
  must(r.json.contractVersion==="uyap.document-sync.v1","sync contract version");
  must(r.json.state==="not_synced"&&r.json.command===null,"initial not_synced contract");
  must(r.json.session.manualDownloadPaused===true,"manual pause missing from contract");

  const accepted=await post("/api/uyap/cases/1/sync-documents");
  must(accepted.status===202&&accepted.json.accepted===true,"POST must mean accepted only");
  must(Number(accepted.json.commandId)>0,"commandId missing");
  const cmd1=Number(accepted.json.commandId);

  r=await get("/api/uyap/cases/1/document-sync-status");
  must(r.json.state==="queued"&&r.json.command.id===cmd1&&r.json.terminal===false,"queued contract wrong");
  must(r.json.pollAfterMs===1500,"queued poll interval missing");

  db.prepare("update uyap_command_queue set status='running',attempts=1,dispatched_at=datetime('now') where id=?").run(cmd1);
  r=await get("/api/uyap/cases/1/document-sync-status");
  must(r.json.state==="running"&&r.json.command.id===cmd1&&r.json.active===true,"running contract wrong");

  uyap.reportResult(cmd1,{ok:true,status:200,contentType:"application/json",data:{tumEvraklar:[
    {evrakId:"E1",dosyaId:"DOSYA-1",tur:"Duruşma Zaptı",onaylandigiTarih:"08/10/2026",birimEvrakNo:"1"}
  ]}});
  r=await get("/api/uyap/cases/1/document-sync-status");
  must(r.json.state==="completed"&&r.json.success===true&&r.json.terminal===true,"completed contract wrong");
  must(r.json.documents.resultCount===1&&r.json.documents.remoteCount===1,"completed counts wrong");
  must(r.json.command.id===cmd1,"completed command identity changed");

  const cmd2=uyap.enqueueCaseDocumentSync(2,{priority:6});
  db.prepare("update uyap_command_queue set status='running',attempts=1,dispatched_at=datetime('now') where id=?").run(cmd2);
  uyap.reportResult(cmd2,{ok:true,status:200,contentType:"application/json",data:{tumEvraklar:[]}});
  r=await get("/api/uyap/cases/2/document-sync-status");
  must(r.json.state==="empty"&&r.json.success===true&&r.json.documents.resultCount===0,"empty contract wrong");

  const cmd3=uyap.enqueueCaseDocumentSync(3,{priority:6});
  db.prepare("update uyap_command_queue set status='failed',error='fixture failure',finished_at=datetime('now') where id=?").run(cmd3);
  r=await get("/api/uyap/cases/3/document-sync-status");
  must(r.json.state==="failed"&&r.json.success===false&&r.json.terminal===true,"failed contract wrong");

  const cmd4=uyap.enqueueCaseDocumentSync(4,{priority:6});
  setting("uyap_session_state","login_required");
  r=await get("/api/uyap/cases/4/document-sync-status");
  must(r.json.state==="login_required"&&r.json.requiresLogin===true&&r.json.success===false,"login_required contract wrong");
  setting("uyap_session_state","ready");
  db.prepare("update uyap_command_queue set status='cancelled',error='fixture cleanup',finished_at=datetime('now') where id=?").run(cmd4);

  const cmd5=uyap.enqueueCaseDocumentSync(5,{priority:6});
  db.prepare("update uyap_command_queue set status='completed',result_json=?,finished_at=datetime('now') where id=?")
    .run(JSON.stringify({tumEvraklar:[{evrakId:"UNBOUND",dosyaId:"DOSYA-5",tur:"Karar"}]}),cmd5);
  r=await get("/api/uyap/cases/5/document-sync-status");
  must(r.json.state==="metadata_unbound"&&r.json.success===false&&r.json.terminal===true,"metadata_unbound contract wrong");

  // Seed an observed request with arbitrary field names: Core reports shape but still refuses semantic binding.
  db.prepare(`insert into uyap_endpoint_observations(method,host,path,status,content_type,sample_keys_json,sample_request_json)
    values('POST','avukat.uyap.gov.tr','/search_phrase_detayli.ajx',200,'application/json','[]',?)`)
    .run(JSON.stringify({query:{q:"observed"},body:{observedCourtField:"X",observedYearField:2026},headers:{"Content-Type":"application/json"}}));
  r=await get("/api/uyap/case-search-schema");
  must(r.json.state==="observed_unverified"&&r.json.observed===true,"unverified observed schema not detected");
  must(r.json.requestShape.body.observedCourtField==="string"&&r.json.requestShape.body.observedYearField==="number","observed shape altered");
  must(r.json.targetedSearch.ready===false&&r.json.targetedSearch.reason==="observed_schema_missing_required_fields","Core guessed semantic bindings");

  must(uyap.sessionState().manualDownloadPaused===true,"document sync contract flow cleared manual pause");

  console.log(JSON.stringify({
    ok:true,
    httpContract:true,
    states:["queued","running","completed","empty","failed","login_required","metadata_unbound"],
    commandIdentityStable:true,
    acceptedIsNotCompleted:true,
    searchSchemaFailClosed:true,
    observedShapeNoSemanticGuess:true,
    manualDownloadPausePreserved:true
  }));
})().finally(async()=>{
  await new Promise(r=>server.close(r));
  try{db.close()}catch{}
  fs.rmSync(root,{recursive:true,force:true});
}).catch(e=>{console.error(e);process.exitCode=1});
