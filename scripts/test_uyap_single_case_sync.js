const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
function must(ok,msg){if(!ok)throw new Error(msg)}
const root=fs.mkdtempSync(path.join(os.tmpdir(),"bono-single-case-sync-"));
process.env.BONO_DB_PATH=path.join(root,"bono.db");
process.env.USERPROFILE=root;
const db=require("../bridge/db");
const uyap=require("../bridge/uyap");

function setting(k,v){db.prepare("insert into app_settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value").run(k,v)}
function addCase(id,no,dosyaId){
  db.prepare("insert into cases(id,external_id,court,court_file_no,status,uyap_dosya_id) values(?,?,?,?,?,?)")
    .run(id,"uyap:fixture:"+id,"Fixture Mahkemesi",no,"open",dosyaId);
}
setting("uyap_integration_mode","browser_readonly");
setting("uyap_session_state","ready");
setting("uyap_manual_download_pause","1");
setting("uyap_document_download_state","paused_manual");
db.prepare(`insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms)
 values('document.list','POST','avukat.uyap.gov.tr','/dosya_evrak_bilgileri.ajx','docs',1,0)`).run();
addCase(1,"2026/1","DOSYA-1");
addCase(10,"2026/10","DOSYA-10");

must(uyap.caseDocumentSyncStatus(1).state==="not_synced","fresh case should be not_synced");
const one=uyap.enqueueCaseDocumentSync(1,{priority:6,purpose:"manual_case_sync",source:"fixture"});
const oneAgain=uyap.enqueueCaseDocumentSync(1,{priority:6,purpose:"manual_case_sync",source:"fixture-repeat"});
must(one===oneAgain,"same case duplicate sync should reuse active command");
const ten=uyap.enqueueCaseDocumentSync(10,{priority:6,purpose:"manual_case_sync",source:"fixture"});
must(ten!==one,"case 1 must not prefix-collide with case 10");
must(uyap.caseDocumentSyncStatus(1).state==="queued","case 1 should be queued");

let cmd=uyap.claimNext("avukat.uyap.gov.tr","query");
must(cmd&&cmd.id===one,"case 1 query should claim first");
must(uyap.caseDocumentSyncStatus(1).state==="running","case 1 should be running");

const payload={tumEvraklar:[
 {evrakId:"E-1",dosyaId:"DOSYA-1",tur:"Duruşma Zaptı",onaylandigiTarih:"08/10/2026",birimEvrakNo:"1"},
 {evrakId:"E-2",dosyaId:"DOSYA-1",tur:"Tensip Zaptı",onaylandigiTarih:"07/10/2026",birimEvrakNo:"2"}
]};
uyap.reportResult(one,{ok:true,status:200,contentType:"application/json",data:payload});
let st=uyap.caseDocumentSyncStatus(1);
must(st.state==="completed","completed list should be completed, got "+st.state);
must(st.resultCount===2&&st.remoteCount===2,"result must be bound into DB");
must(uyap.remoteDocuments(1).length===2,"remote-documents should expose two rows");
must(uyap.sessionState().manualDownloadPaused===true,"document list sync cleared manual pause");

// Empty list confirmed by completed payload.
cmd=uyap.claimNext("avukat.uyap.gov.tr","query"); // case 10 existing queued
must(cmd&&cmd.id===ten,"case 10 command missing");
uyap.reportResult(ten,{ok:true,status:200,contentType:"application/json",data:{tumEvraklar:[]}});
st=uyap.caseDocumentSyncStatus(10);
must(st.state==="empty"&&st.resultCount===0&&st.remoteCount===0,"true empty list not distinguished");

// Failed list.
addCase(20,"2026/20","DOSYA-20");
const failed=uyap.enqueueCaseDocumentSync(20,{priority:6,purpose:"manual_case_sync"});
db.prepare("update uyap_command_queue set status='failed',error='fixture failure',finished_at=datetime('now') where id=?").run(failed);
must(uyap.caseDocumentSyncStatus(20).state==="failed","failed list not exposed");

// Login required must be explicit and must not silently claim.
addCase(30,"2026/30","DOSYA-30");
const loginCmd=uyap.enqueueCaseDocumentSync(30,{priority:6,purpose:"manual_case_sync"});
setting("uyap_session_state","login_required");
st=uyap.caseDocumentSyncStatus(30);
must(st.state==="login_required","queued command under logged-out session should show login_required");
const blocked=uyap.claimNext("avukat.uyap.gov.tr","query");
must(blocked&&blocked.wait===true&&blocked.reason==="uyap_login_required","login_required should block claim");
setting("uyap_session_state","ready");
db.prepare("update uyap_command_queue set status='cancelled',error='fixture cleanup',finished_at=datetime('now') where id=?").run(loginCmd);

// Metadata returned but not bound diagnostic.
addCase(40,"2026/40","DOSYA-40");
const unbound=uyap.enqueueCaseDocumentSync(40,{priority:6,purpose:"manual_case_sync"});
db.prepare("update uyap_command_queue set status='completed',result_json=?,finished_at=datetime('now') where id=?")
 .run(JSON.stringify({tumEvraklar:[{evrakId:"UNBOUND",dosyaId:"DOSYA-40",tur:"Karar"}]}),unbound);
st=uyap.caseDocumentSyncStatus(40);
must(st.state==="metadata_unbound","unbound metadata should be diagnostic state");

const activeCount=db.prepare(`select count(*) n from uyap_command_queue where endpoint_key='document.list' and status in ('queued','running')`).get().n;
must(activeCount===0,"fixture left active document.list commands");
console.log(JSON.stringify({
 ok:true,
 sameCaseDedup:true,
 casePrefixCollisionPrevented:true,
 completedBound:true,
 trueEmptyDetected:true,
 failedDetected:true,
 loginRequiredDetected:true,
 metadataUnboundDetected:true,
 manualDownloadPausePreserved:true
}));
try{db.close()}catch{}
fs.rmSync(root,{recursive:true,force:true});
