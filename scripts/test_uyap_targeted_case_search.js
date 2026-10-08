const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
function must(ok,msg){if(!ok)throw new Error(msg)}
const root=fs.mkdtempSync(path.join(os.tmpdir(),"bono-targeted-case-search-"));
process.env.BONO_DB_PATH=path.join(root,"bono.db");
process.env.USERPROFILE=root;
const db=require("../bridge/db");
const uyap=require("../bridge/uyap");
function setting(k,v){db.prepare("insert into app_settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value").run(k,v)}
setting("uyap_integration_mode","browser_readonly");
setting("uyap_session_state","ready");
setting("uyap_manual_download_pause","1");
setting("uyap_document_download_state","paused_manual");
db.prepare(`insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms)
 values('case.search','POST','avukat.uyap.gov.tr','/search_phrase_detayli.ajx','search',1,0)`).run();
db.prepare(`insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms)
 values('case.units','POST','avukat.uyap.gov.tr','/yargiBirimleriSorgula_brd.ajx','units',1,0)`).run();
db.prepare(`insert into uyap_endpoint_observations(method,host,path,status,content_type,sample_keys_json,sample_request_json,last_seen_at,hit_count)
 values('POST','avukat.uyap.gov.tr','/search_phrase_detayli.ajx',200,'application/json','[]',?,datetime('now'),18)`).run(
 JSON.stringify({query:{},body:{dosyaDurumKod:1,pageSize:500,pageNumber:1,birimId:"",birimTuru2:"0926",birimTuru3:"1"},headers:{Accept:"application/json, text/plain, */*","Content-Type":"application/json"}})
);
db.prepare(`insert into uyap_command_queue(command_type,endpoint_key,payload_json,status,result_json,finished_at)
 values('fetch_json','case.units',?,'completed',?,datetime('now'))`).run(
 JSON.stringify({query:{},body:{yargiTuru:"1"},context:{yargiTuru:1}}),
 JSON.stringify([{altSistKodu:-1,tablo:"0926",kod:"İŞ MAHKEMESİ"}])
);

const schema=uyap.caseSearchSchemaStatus();
must(schema.state==="ready"&&schema.verified===true,"observed schema not verified");
must(schema.fieldBindings.request.unitType==="birimTuru2","unit binding missing");
must(schema.fieldBindings.response.fileNumber==="dosyaNo","response file number binding missing");
must(schema.message.includes("exact"),"schema must explain exact response filtering");
const options=uyap.caseSearchOptions();
must(options.ready&&options.units.length===1&&options.units[0].birimTuru2==="0926","observed unit option missing");

const target={yargiTuru:1,birimTuru2:"0926",court:"Kocaeli 3. İş Mahkemesi",year:2026,baseNumber:100,dosyaDurumKod:0};
const first=uyap.enqueueTargetedCaseSearch(target);
must(first.searchId&&first.commandId&&!first.dedup,"targeted search not enqueued");
const duplicate=uyap.enqueueTargetedCaseSearch(target);
must(duplicate.dedup===true&&duplicate.searchId===first.searchId&&duplicate.commandId===first.commandId,"active target search not deduped");

let q=db.prepare("select * from uyap_command_queue where id=?").get(first.commandId);
let p=JSON.parse(q.payload_json);
must(JSON.stringify(p.body)===JSON.stringify({dosyaDurumKod:0,pageSize:500,pageNumber:1,birimId:"",birimTuru2:"0926",birimTuru3:"1"}),"request body differs from observed schema");
must(!("year" in p.body)&&!("baseNumber" in p.body)&&!("court" in p.body)&&!("esasNo" in p.body),"guessed target fields leaked into request body");
must(p.context.targetedCaseSearch===true&&p.context.targetDosyaNo==="2026/100","target context missing");

db.prepare("update uyap_command_queue set status='running',attempts=1,dispatched_at=datetime('now') where id=?").run(first.commandId);
let status=uyap.targetedCaseSearchStatus(first.searchId);
must(status.state==="running"&&status.commands[0].id===first.commandId,"running status wrong");

// Result contains unrelated cases plus one exact match. Only the exact row may be inserted.
uyap.reportResult(first.commandId,{ok:true,status:200,contentType:"application/json",data:[[
 {dosyaId:"TOKEN-OTHER",dosyaNo:"2026/99",dosyaDurumKod:0,dosyaDurum:"Açık",dosyaTurKod:15,dosyaTur:"Hukuk Dava Dosyası",birimAdi:"Kocaeli 3. İş Mahkemesi",birimId:"111",birimTuru1:"09",birimTuru2:"0926",birimTuru3:"0992"},
 {dosyaId:"TOKEN-WRONG-COURT",dosyaNo:"2026/100",dosyaDurumKod:0,dosyaDurum:"Açık",dosyaTurKod:15,dosyaTur:"Hukuk Dava Dosyası",birimAdi:"Kocaeli 2. İş Mahkemesi",birimId:"222",birimTuru1:"09",birimTuru2:"0926",birimTuru3:"0992"},
 {dosyaId:"TOKEN-MATCH",dosyaNo:"2026/100",dosyaDurumKod:0,dosyaDurum:"Açık",dosyaTurKod:15,dosyaTur:"Hukuk Dava Dosyası",birimAdi:"Kocaeli 3. İş Mahkemesi",birimId:"333",birimTuru1:"09",birimTuru2:"0926",birimTuru3:"0992"}
],3]});
status=uyap.targetedCaseSearchStatus(first.searchId);
must(status.state==="completed"&&status.success===true&&status.match?.caseId,"exact match not completed");
must(status.match.court==="Kocaeli 3. İş Mahkemesi"&&status.match.fileNo==="2026/100","wrong matched case");
must(Number(db.prepare("select count(*) n from cases").get().n)===1,"unrelated search results were persisted");
must(db.prepare("select court_file_no from cases").get().court_file_no==="2026/100","wrong case persisted");

const searchStored=db.prepare("select result_json from uyap_command_queue where id=?").get(first.commandId);
const stored=JSON.parse(searchStored.result_json);
must(stored.type==="targeted_case_search_result"&&stored.matches.length===1,"targeted result summary not stored");
must(!JSON.stringify(stored).includes("TOKEN-OTHER")&&!JSON.stringify(stored).includes("TOKEN-WRONG-COURT"),"unrelated opaque ids retained in targeted result");

// Pagination with no match on page 1 must enqueue page 2 with same search id.
const secondTarget={yargiTuru:1,birimTuru2:"0926",court:"İstanbul 1. İş Mahkemesi",year:2025,baseNumber:777,dosyaDurumKod:1};
const second=uyap.enqueueTargetedCaseSearch(secondTarget);
db.prepare("update uyap_command_queue set status='running',attempts=1,dispatched_at=datetime('now') where id=?").run(second.commandId);
uyap.reportResult(second.commandId,{ok:true,status:200,contentType:"application/json",data:[[],501]});
status=uyap.targetedCaseSearchStatus(second.searchId);
must(status.state==="queued"&&status.commands.length===2,"pagination did not continue targeted search");
const page2=status.commands[1].id;
q=db.prepare("select payload_json from uyap_command_queue where id=?").get(page2);p=JSON.parse(q.payload_json);
must(p.body.pageNumber===2&&p.context.searchId===second.searchId,"pagination command lost search identity");
db.prepare("update uyap_command_queue set status='running',attempts=1,dispatched_at=datetime('now') where id=?").run(page2);
uyap.reportResult(page2,{ok:true,status:200,contentType:"application/json",data:[[],501]});
status=uyap.targetedCaseSearchStatus(second.searchId);
must(status.state==="not_found"&&status.terminal===true,"not_found terminal state wrong");

// Search must never create document or PDF commands.
const docCommands=Number(db.prepare("select count(*) n from uyap_command_queue where endpoint_key='document.list'").get().n||0);
const pdfCommands=Number(db.prepare("select count(*) n from uyap_command_queue where endpoint_key='document.pdf'").get().n||0);
must(docCommands===0&&pdfCommands===0,"targeted case search triggered document/download commands");
must(uyap.sessionState().manualDownloadPaused===true,"targeted case search cleared manual download pause");

setting("uyap_session_state","login_required");
let loginBlocked=false;try{uyap.enqueueTargetedCaseSearch({...target,baseNumber:101})}catch(e){loginBlocked=/oturumu gerekli/i.test(String(e.message))}
must(loginBlocked,"login_required did not block targeted search");

console.log(JSON.stringify({
 ok:true,
 observedRequestUsed:true,
 requestBodyKeys:["dosyaDurumKod","pageSize","pageNumber","birimId","birimTuru2","birimTuru3"],
 yearAndBaseFilteredFromResponse:true,
 exactCourtAndFileNoOnly:true,
 unrelatedCasesNotPersisted:true,
 paginationPreservesSearchId:true,
 activeSearchDedup:true,
 noDocumentList:true,
 noPdfQueue:true,
 manualDownloadPausePreserved:true,
 loginRequiredGuard:true
}));
try{db.close()}catch{}
fs.rmSync(root,{recursive:true,force:true});
