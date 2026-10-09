const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawn}=require("node:child_process");
const {DatabaseSync}=require("node:sqlite");

function must(ok,msg){if(!ok)throw new Error(msg)}
const root=fs.mkdtempSync(path.join(os.tmpdir(),"bono-bridge-query-e2e-"));
const dbPath=path.join(root,"fixture.db");
const port=47993;
const base="http://127.0.0.1:"+port;

process.env.BONO_DB_PATH=dbPath;
process.env.USERPROFILE=root;
const db=require("../bridge/db");

function setting(k,v){
  db.prepare("insert into app_settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value").run(k,v);
}
setting("uyap_integration_mode","browser_readonly");
setting("uyap_session_state","ready");
setting("uyap_manual_download_pause","1");
setting("uyap_manual_download_reason","fixture_pause");
setting("uyap_document_download_state","paused_manual");

db.prepare(`insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms)
 values('document.list','POST','avukat.uyap.gov.tr','/list_dosya_evraklar.ajx','docs',1,0)`).run();
db.prepare(`insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms)
 values('document.pdf','GET','vatandas.uyap.gov.tr','/view_document_brd.uyap','download',1,0)`).run();

db.prepare("insert into office_files(id,file_no,title,status) values(1,'F-TEST-1','Fixture Dosyası','open')").run();
db.prepare(`insert into cases(id,external_id,court,court_file_no,case_type,status,client_name,office_file_id,uyap_dosya_id)
 values(1,'uyap:fixture:1','Kocaeli 1. Asliye Hukuk Mahkemesi','2026/101','Hukuk','open','Beraat Cengiz',1,'DOSYA-FIXTURE-1')`).run();
db.prepare("insert into parties(case_id,name,role,is_client) values(1,'Beraat Cengiz','Davacı',1)").run();
db.prepare("insert into parties(case_id,name,role,is_client) values(1,'Fixture Karşı Taraf','Davalı',0)").run();
db.prepare("UPDATE cases SET uyap_birim_id='unit1' WHERE id=1").run();
const policy=require('../bridge/uyap_user_queries'),crypto=require('node:crypto');
policy.migrate(db,{expectedQueued:0,backupManifest:{schema:1,verified:true,queueIdDigest:policy.digest([])}});
policy.certifyBinding(db,{kind:'verified_portal_binding',caseId:1,unitId:'unit1',caseNo:'2026/101',dosyaId:'DOSYA-FIXTURE-1',evidenceRef:'observation:'+crypto.randomUUID(),adapter:'court_documents_v1'});
db.prepare("insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms) values(?,?,?,?,?,?,?)").run("cbs.search","POST","avukat.uyap.gov.tr","/avukat_dosya_sorgula_cbs_brd.ajx","search",1,0);
db.prepare("insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms) values(?,?,?,?,?,?,?)").run("cbs.units","POST","avukat.uyap.gov.tr","/cbs_birim_sorgula.ajx","units",1,0);
const observed={query:{},body:{dosyaDurumKod:0,pageSize:500,pageNumber:1,birimId:"",birimTuru2:"OBSERVED-UNIT",birimTuru3:"3"},headers:{"Content-Type":"application/json"}};
db.prepare("insert into uyap_endpoint_observations(method,host,path,status,content_type,sample_keys_json,sample_request_json,last_seen_at,hit_count) values(?,?,?,?,?,?,?,datetime('now'),?)").run("POST","avukat.uyap.gov.tr","/avukat_dosya_sorgula_cbs_brd.ajx",200,"application/json","[]",JSON.stringify(observed),9);
db.prepare("insert into uyap_command_queue(command_type,endpoint_key,payload_json,status,result_json,finished_at) values(?,?,?,?,?,datetime('now'))").run("fetch_json","cbs.units",JSON.stringify({query:{},body:{ilKodu:26},context:{ilKodu:26}}),"completed",JSON.stringify([{birimId:"OBSERVED-UNIT",birimAdi:"Eskişehir Cumhuriyet Başsavcılığı"}]));
db.prepare("insert into cases(id,external_id,court,court_file_no,case_type,status,client_name) values(?,?,?,?,?,?,?)").run(2,"fixture:cbs:2","Eskişehir Cumhuriyet Başsavcılığı","2026/51832","Soruşturma","open","Fixture Müvekkil");

db.close();

const cp=spawn(process.execPath,[path.join(__dirname,"..","bridge","server.js")],{
  cwd:path.join(__dirname,".."),
  env:{...process.env,BONO_DB_PATH:dbPath,BONO_PORT:String(port),BONO_DISABLE_WORKER:"1",USERPROFILE:root},
  stdio:["ignore","pipe","pipe"]
});
let childOut="",childErr="";
cp.stdout.on("data",d=>childOut+=d);
cp.stderr.on("data",d=>childErr+=d);

async function req(url,options){
  const r=await fetch(base+url,{headers:{"Content-Type":"application/json","X-Bono-User-Action":"1"},...options});
  const text=await r.text();
  let body=null;try{body=text?JSON.parse(text):null}catch{body=text}
  return {status:r.status,body};
}
async function waitHealth(){
  for(let i=0;i<80;i++){
    try{const r=await req("/health");if(r.status===200)return}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error("fixture Core did not start\n"+childOut+"\n"+childErr);
}


async function main(){
 await waitHealth();
 const invalidDiagnostic=await req('/api/uyap/bridge-state',{method:'POST',body:JSON.stringify({state:'invented',tabId:7,frameId:0})});
 must(invalidDiagnostic.status===400,'unknown diagnostic accepted');
 await req('/api/uyap/bridge-state',{method:'POST',body:JSON.stringify({state:'idle',tabId:7,frameId:0,token:'must-not-retain',description:'must-not-retain'})});
 const diagnostic=await req('/api/uyap/session');
 must(!JSON.stringify(diagnostic.body.bridge).includes('must-not-retain'),'diagnostic retained arbitrary fields');
 const makeBrowser=require('./fixtures/bridge_browser_runtime');
 const runtime=makeBrowser({base,payload:{tumEvraklar:[{evrakId:'E-1',dosyaId:'DOSYA-FIXTURE-1',tur:'Fixture',onaylandigiTarih:'08/10/2026'}]},failFirstDelivery:true});
 const settle=()=>new Promise(r=>setTimeout(r,120));
 runtime.tick();await settle();must(runtime.portalRequests.length===0,'startup sent portal query');
 const queued=await req('/api/uyap/cases/1/sync-documents',{method:'POST',body:JSON.stringify({requestKey:crypto.randomUUID(),refresh:true})});
 must(queued.status===202,'desktop API rejected action');
 const id=Number(queued.body.commandId);
 for(let i=0;i<30;i++){
  runtime.tick();await settle();
  const st=await req('/api/uyap/cases/1/document-sync-status');if(st.body.state==='completed')break;
 }
 const st=await req('/api/uyap/cases/1/document-sync-status');
 must(st.body.state==='completed'&&st.body.remoteCount===1,'real extension pipeline did not return metadata: '+JSON.stringify(st));
 must(runtime.portalRequests.filter(r=>r.path==='/get_avukat_id.ajx').length===1,'background auth not once per action');
 must(runtime.portalRequests.filter(r=>r.path==='/list_dosya_evraklar.ajx').length===1,'query duplicated after local delivery loss');
 must(runtime.deliveryCalls()===2,'local-only delivery retry missing');
 const foreign=await runtime.foreignResult({id,ok:true});must(foreign.reason==='executor_context_mismatch','foreign executor accepted');
 const result=runtime.messages.find(m=>m.type==='command_result').data;
 must((await runtime.sendResult({...result,executionContext:{...result.executionContext,documentId:'another-page'}})).reason==='executor_context_mismatch','same tab different page accepted after worker restart');
 must((await runtime.sendResult({...result,executionContext:{...result.executionContext,id:'another-execution'}})).reason==='executor_context_mismatch','different execution accepted after worker restart');
 must(!JSON.stringify(runtime.stored).includes('fixture-opaque'),'claim storage leaked target identity');
 must(result.executionContext?.id&&result.executionContext.documentId,'missing command/document context');
 const before=runtime.deliveryCalls();runtime.injectResult({...result,executionContext:{...result.executionContext,id:'wrong'}});await settle();must(runtime.deliveryCalls()===before,'old or foreign result forwarded');
 const info=await req('/api/uyap/session');must(info.body.session.manualDownloadPaused===true,'pause changed');
 const q=await req('/api/uyap/queue');must(!q.body.some(r=>r.command_type==='download_document'),'automatic download');

 const resetRate=()=>{const f=new DatabaseSync(dbPath);f.prepare('update uyap_rate_state set next_allowed_ms=0 where id=1').run();f.close();};
 resetRate();
 const cbsRuntime=makeBrowser({base,payload:[[{birimId:'OBSERVED-UNIT',dosyaNo:'2026/51832',dosyaId:'fixture-opaque-2',dosyaDurumKod:0}],1]});
 const cbsStart=await req('/api/uyap/cases/2/sync-documents',{method:'POST',body:JSON.stringify({requestKey:crypto.randomUUID(),refresh:true})});
 must(cbsStart.status===202,'CBS desktop query rejected: '+JSON.stringify(cbsStart));
 let history;
 for(let i=0;i<30;i++){cbsRuntime.tick();await settle();history=await req('/api/uyap/cases/2/query-history');if(history.body[0]?.state==='completed')break;}
 must(history.body[0]?.state==='completed','CBS return pipeline failed: '+JSON.stringify(history));
 const cases=await req('/api/uyap/cases');must(cases.body.find(c=>c.id===2)?.uyap_dosya_id==='fixture-opaque-2','CBS exact identity not returned');
 const cbsDocs=await req('/api/uyap/cases/2/remote-documents');must(cbsDocs.body.length===0,'unproved CBS metadata imported');
 must(cbsRuntime.portalRequests.filter(r=>r.path==='/avukat_dosya_sorgula_cbs_brd.ajx').length===1,'CBS duplicate query');
 resetRate();
 const deniedRuntime=makeBrowser({base,payload:{errorCode:'PRTL_GNL_1-1'}});
 const deniedStart=await req('/api/uyap/cases/1/sync-documents',{method:'POST',body:JSON.stringify({requestKey:crypto.randomUUID(),refresh:true})});
 must(deniedStart.status===202,'denial fixture action rejected');
 let deniedHistory;
 for(let i=0;i<30;i++){deniedRuntime.tick();await settle();deniedHistory=await req('/api/uyap/cases/1/query-history');if(deniedHistory.body[0]?.state==='failed')break;}
 must(deniedHistory.body[0]?.error_code==='uyap_application_denied','HTTP200 denial was not distinguished: '+JSON.stringify(deniedHistory));
 const blocker=new DatabaseSync(dbPath);blocker.prepare("update app_settings set value='login_required' where key='uyap_session_state'").run();blocker.close();
 // Core deliberately retains an in-flight command diagnostic for 15 seconds.
 await new Promise(resolve=>setTimeout(resolve,15500));
 const portalBefore=cbsRuntime.portalRequests.length;cbsRuntime.tick();await settle();
 const blocked=await req('/api/uyap/session');must(blocked.body.bridge.waitReason==='uyap_login_required','Core wait reason lost in real background/content pipeline: '+JSON.stringify(blocked.body));
 must(cbsRuntime.portalRequests.length===portalBefore,'session diagnosis sent a portal request');
 console.log(JSON.stringify({ok:true,realCoreHttp:true,realExtensionSources:true,syntheticChromeAndUyap:true,inactiveTab:true,mv3RestartDeliveryRecovered:true,sameTabDifferentPageAndExecutionRejected:true,coreSessionWaitPreserved:true,diagnosisWithoutPortalRequest:true,cbsIdentityReturned:true,cbsMetadataStillBlocked:true,http200DenialDistinguished:true,metadataReturned:1,portalQueryCount:1,localDeliveryRetryOnly:true,foreignAndLateResultRejected:true,noAutomaticDownload:true,manualPausePreserved:true}));
}
main().catch(e=>{console.error(e);console.error(childErr);process.exitCode=1}).finally(()=>{try{cp.kill()}catch{}setTimeout(()=>{try{fs.rmSync(root,{recursive:true,force:true})}catch{}},100)});
