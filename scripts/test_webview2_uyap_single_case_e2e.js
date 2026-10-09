const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawn}=require("node:child_process");
const {DatabaseSync}=require("node:sqlite");

function must(ok,msg){if(!ok)throw new Error(msg)}
const root=fs.mkdtempSync(path.join(os.tmpdir(),"bono-webview2-uyap-e2e-"));
const dbPath=path.join(root,"fixture.db");
const port=47991;
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

  const list=await req("/api/uyap/cases");
  must(list.status===200&&Array.isArray(list.body),"case list unavailable");
  const file=list.body.find(x=>Number(x.id)===1);
  must(file,"fixture case missing");
  must(file.client_name==="Beraat Cengiz","client missing from case list");
  must(String(file.party_names||"").includes("Beraat Cengiz")&&String(file.party_names||"").includes("Fixture Karşı Taraf"),"party_names missing from case list");

  let docs=await req("/api/uyap/cases/1/remote-documents");
  must(docs.status===200&&docs.body.length===0,"documents should start empty");
  let st=await req("/api/uyap/cases/1/document-sync-status");
  must(st.body.state==="not_synced","initial lifecycle should be not_synced: "+JSON.stringify(st.body));

  const queued=await req("/api/uyap/cases/1/sync-documents",{method:"POST",body:JSON.stringify({requestKey:crypto.randomUUID(),refresh:true})});
  must(queued.status===202&&queued.body.commandId>0,"sync did not enqueue");
  const commandId=Number(queued.body.commandId);
  st=await req("/api/uyap/cases/1/document-sync-status");
  must(st.body.state==="queued"&&Number(st.body.commandId)===commandId,"queued lifecycle missing");

  const claim=await req("/api/uyap/commands/next?host=avukat.uyap.gov.tr&lane=query");
  must(claim.body.path==='/list_dosya_evraklar.ajx'&&claim.body.method==='POST',"document request does not match observed contract");
  must(claim.status===200&&Number(claim.body.id)===commandId&&claim.body.endpointKey==="document.list","fake extension could not claim document.list");
  st=await req("/api/uyap/cases/1/document-sync-status");
  must(st.body.state==="running","running lifecycle missing");

  const payload={tumEvraklar:[
    {evrakId:"E-1",dosyaId:"DOSYA-FIXTURE-1",tur:"Duruşma Zaptı",onaylandigiTarih:"08/10/2026",birimEvrakNo:"1",dosyaAdi:"durusma.pdf"},
    {evrakId:"E-2",dosyaId:"DOSYA-FIXTURE-1",tur:"Tensip Zaptı",onaylandigiTarih:"07/10/2026",birimEvrakNo:"2",dosyaAdi:"tensip.udf"}
  ]};
  const complete=await req("/api/uyap/commands/"+commandId+"/result",{
    method:"POST",
    body:JSON.stringify({ok:true,status:200,contentType:"application/json",data:payload})
  });
  must(complete.status===200&&complete.body.ok===true,"fake UYAP result rejected");

  st=await req("/api/uyap/cases/1/document-sync-status");
  must(st.body.state==="completed"&&st.body.remoteCount===2&&st.body.resultCount===2,"completed lifecycle missing: "+JSON.stringify(st.body));
  docs=await req("/api/uyap/cases/1/remote-documents");
  must(docs.status===200&&docs.body.length===2,"document list did not refresh to two rows");

  const q=await req("/api/uyap/queue?limit=100");
  must(!q.body.some(x=>x.command_type==="download_document"),"document.list automatically queued a PDF/UDF download");

  const remoteId=Number(docs.body[0].id);
  const noApproval=await req("/api/uyap/remote-documents/"+remoteId+"/download",{method:"POST",body:JSON.stringify({requestKey:crypto.randomUUID(),refresh:true})});
  must(noApproval.status===409,"download endpoint accepted request without explicit approval");

  const approved=await req("/api/uyap/cases/1/approved-downloads",{method:"POST",body:JSON.stringify({confirmed:true,documentIds:[remoteId],requestKey:crypto.randomUUID()})});
  must(approved.status===202,"approved download was not queueable in fixture");
  const pausedDownload=await req("/api/uyap/commands/next?host=vatandas.uyap.gov.tr&lane=download");
  must(pausedDownload.status===204,"manual download pause did not block fake download execution");

  const second=await req("/api/uyap/cases/1/sync-documents",{method:"POST",body:JSON.stringify({requestKey:crypto.randomUUID(),refresh:true})});
  must(second.status===202&&second.body.commandId>0,"second sync did not enqueue");
  const failId=Number(second.body.commandId);
  const direct=new DatabaseSync(dbPath);
  direct.prepare("update uyap_command_queue set status='failed',attempts=max_attempts,error='fixture document.list failure',finished_at=datetime('now') where id=?").run(failId);
  direct.close();
  st=await req("/api/uyap/cases/1/document-sync-status");
  must(st.body.state==="failed"&&String(st.body.error||"").includes("fixture"),"failed lifecycle missing: "+JSON.stringify(st.body));

  const view=fs.readFileSync(path.join(__dirname,"..","web","js","views","active","uyap.js"),"utf8");
  const {partyText}=await import("../web/js/case-query-state.mjs");
  must(view.includes("partyText(r)")&&partyText({party_names:"Fixture Taraf",representative_names:"Fixture Vekil"}).includes("Fixture Taraf")&&partyText({representative_names:"Fixture Vekil"}).includes("Fixture Vekil"),"list party rendering was lost");
  must(view.includes("file.party_names"),"detail party rendering was lost");
  must(view.includes("UYAP'ta Sorgula")&&view.includes("mountUserQueries"),"controlled single-case query CTA missing");
  must(view.includes("mountUserQueries"),"user-query UI binding missing");
  must(view.includes("Fiziksel evrak indirme ayrı onaydır")||view.includes("PDF/UDF dosyalarını indirmez"),"no-download disclosure missing");

  console.log(JSON.stringify({
    ok:true,
    fixtureCore:true,
    isolatedDb:dbPath,
    caseSelection:true,
    partiesInListAndDetail:true,
    lifecycle:["not_synced","queued","running","completed","failed"],
    autoRefreshContract:true,
    remoteDocuments:2,
    noAutomaticDownload:true,
    explicitDownloadApproval:true,
    manualDownloadPauseBlockedExecution:true
  }));
}

main().catch(e=>{console.error(e);console.error(childOut);console.error(childErr);process.exitCode=1})
.finally(()=>{
  try{cp.kill()}catch{}
  setTimeout(()=>{try{fs.rmSync(root,{recursive:true,force:true})}catch{}},100);
});
