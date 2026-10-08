const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
function must(ok,msg){if(!ok)throw new Error(msg)}
const root=fs.mkdtempSync(path.join(os.tmpdir(),"bono-cbs-party-search-"));
process.env.BONO_DB_PATH=path.join(root,"bono.db");
process.env.USERPROFILE=root;
const db=require("../bridge/db");
const uyap=require("../bridge/uyap");
function setting(k,v){db.prepare("insert into app_settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value").run(k,v)}
setting("uyap_integration_mode","browser_readonly");
setting("uyap_session_state","ready");
setting("uyap_manual_download_pause","1");
setting("uyap_document_download_state","paused_manual");
for(const ep of [
 ["cbs.search","POST","/avukat_dosya_sorgula_cbs_brd.ajx"],
 ["cbs.units","POST","/cbs_birim_sorgula.ajx"],
 ["case.parties","POST","/dosya_taraf_bilgileri_brd.ajx"],
 ["document.list","POST","/list_dosya_evraklar.ajx"],
 ["document.pdf","GET","/view_document_brd.uyap"]
]) db.prepare("insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms) values(?,?,'avukat.uyap.gov.tr',?,'fixture',1,0)").run(...ep);
db.prepare(`insert into uyap_endpoint_observations(method,host,path,status,content_type,sample_keys_json,sample_request_json,last_seen_at,hit_count)
 values('POST','avukat.uyap.gov.tr','/avukat_dosya_sorgula_cbs_brd.ajx',200,'application/json','[]',?,datetime('now'),3)`).run(
 JSON.stringify({query:{},body:{dosyaDurumKod:0,pageSize:500,pageNumber:1,birimId:"",birimTuru2:"9000001",birimTuru3:"3"},headers:{"Content-Type":"application/json"}})
);
db.prepare(`insert into uyap_endpoint_observations(method,host,path,status,content_type,sample_keys_json,sample_request_json,last_seen_at,hit_count)
 values('POST','avukat.uyap.gov.tr','/dosya_taraf_bilgileri_brd.ajx',200,'application/json','[]',?,datetime('now'),5)`).run(
 JSON.stringify({query:{},body:{dosyaId:"OBSERVED"},headers:{"Content-Type":"application/json"}})
);
db.prepare(`insert into uyap_command_queue(command_type,endpoint_key,payload_json,status,result_json,finished_at)
 values('fetch_json','cbs.units',?,'completed',?,datetime('now'))`).run(
 JSON.stringify({query:{},body:{ilKodu:1},context:{discovery:true,stage:"cbs_units",ilKodu:1}}),
 JSON.stringify([{birimAdi:"Örnek Cumhuriyet Başsavcılığı",birimId:"9000001"}])
);

const schema=uyap.cbsPartySearchSchemaStatus();
must(schema.ready&&schema.cbsSearch.verified&&schema.partyLookup.verified,"observed CBS/party schema not ready");
must(schema.matching.partyField==="adi"&&schema.matching.mode==="exact_normalized","party matching contract wrong");
const units=uyap.cbsUnitOptions(99);
must(units.units.length===1&&units.units[0].birimId==="9000001","observed CBS unit missing");

const privateName="Örnek Hedef Kişi";
const s=uyap.enqueueTargetedCbsPartySearch({
 ilKodu:1,birimId:"9000001",partyName:privateName,statuses:[0],openedFrom:"2026-09-01",openedTo:"2026-10-01",maxCandidates:10
});
must(s.searchId&&s.commandIds.length===1&&!s.dedup,"targeted CBS search not queued");
const duplicate=uyap.enqueueTargetedCbsPartySearch({
 ilKodu:1,birimId:"9000001",partyName:privateName,statuses:[0],openedFrom:"2026-09-01",openedTo:"2026-10-01",maxCandidates:10
});
must(duplicate.dedup===true&&duplicate.searchId===s.searchId,"targeted CBS duplicate not suppressed");
const cbsId=s.commandIds[0];
let row=db.prepare("select payload_json from uyap_command_queue where id=?").get(cbsId);
must(!row.payload_json.includes(privateName),"clear party name leaked into CBS queue payload");
let p=JSON.parse(row.payload_json);
must(JSON.stringify(p.body)===JSON.stringify({dosyaDurumKod:0,pageSize:500,pageNumber:1,birimId:"",birimTuru2:"9000001",birimTuru3:"3"}),"CBS body differs from observed schema");

db.prepare("update uyap_command_queue set status='running',attempts=1,dispatched_at=datetime('now') where id=?").run(cbsId);
uyap.reportResult(cbsId,{ok:true,status:200,contentType:"application/json",data:[[
 {dosyaId:"OUTSIDE",dosyaNo:"2026/1",dosyaDurumKod:0,dosyaDurum:"Açık",dosyaTurKod:16,dosyaTur:"CBS Sorusturma Dosyası",dosyaAcilisTarihi:{date:{year:2026,month:8,day:20}},birimAdi:"Örnek Cumhuriyet Başsavcılığı",birimId:"9000001"},
 {dosyaId:"CAND-A",dosyaNo:"2026/2",dosyaDurumKod:0,dosyaDurum:"Açık",dosyaTurKod:16,dosyaTur:"CBS Sorusturma Dosyası",dosyaAcilisTarihi:{date:{year:2026,month:9,day:20}},birimAdi:"Örnek Cumhuriyet Başsavcılığı",birimId:"9000001"},
 {dosyaId:"CAND-B",dosyaNo:"2026/3",dosyaDurumKod:0,dosyaDurum:"Açık",dosyaTurKod:16,dosyaTur:"CBS Sorusturma Dosyası",dosyaAcilisTarihi:{date:{year:2026,month:9,day:25}},birimAdi:"Örnek Cumhuriyet Başsavcılığı",birimId:"9000001"}
],3]});
let status=uyap.targetedCbsPartySearchStatus(s.searchId);
must(status.state==="queued"&&status.partyChecks===2,"date-window party checks wrong");
const partyRows=db.prepare(`select id,payload_json from uyap_command_queue where endpoint_key='case.parties' order by id`).all();
must(partyRows.length===2,"party lookup count wrong");
must(partyRows.every(x=>!x.payload_json.includes(privateName)),"clear party name leaked into party queue payload");
const a=partyRows[0],b=partyRows[1];
db.prepare("update uyap_command_queue set status='running',attempts=1,dispatched_at=datetime('now') where id=?").run(a.id);
uyap.reportResult(a.id,{ok:true,status:200,contentType:"application/json",data:[
 {adi:"Başka Kişi",rol:"Şüpheli",kisiKurum:"Kişi"}
]});
db.prepare("update uyap_command_queue set status='running',attempts=1,dispatched_at=datetime('now') where id=?").run(b.id);
uyap.reportResult(b.id,{ok:true,status:200,contentType:"application/json",data:[
 {adi:"ÖRNEK HEDEF KİŞİ",rol:"Şüpheli",kisiKurum:"Kişi"},
 {adi:"Başka Bir Kişi",rol:"Müşteki",kisiKurum:"Kişi"}
]});
status=uyap.targetedCbsPartySearchStatus(s.searchId);
must(status.state==="completed"&&status.success&&status.matches.length===1,"exact party match not completed");
must(Number(db.prepare("select count(*) n from cases").get().n)===1,"nonmatching CBS cases persisted");
const c=db.prepare("select court,court_file_no from cases").get();
must(c.court_file_no==="2026/3","wrong candidate persisted");
const allQueue=db.prepare("select payload_json,result_json from uyap_command_queue").all();
must(allQueue.every(x=>!String(x.payload_json||"").includes(privateName)&&!String(x.result_json||"").includes(privateName)),"clear target name leaked into stored queue/result");
must(Number(db.prepare("select count(*) n from uyap_command_queue where endpoint_key='document.list'").get().n)===0,"targeted CBS search queued document.list");
must(Number(db.prepare("select count(*) n from uyap_command_queue where endpoint_key='document.pdf'").get().n)===0,"targeted CBS search queued PDF");
must(uyap.sessionState().manualDownloadPaused===true,"targeted CBS search cleared manual pause");

let wideBlocked=false;try{uyap.enqueueTargetedCbsPartySearch({
 ilKodu:1,birimId:"9000001",partyName:"Başka Hedef",statuses:[0],openedFrom:"2026-01-01",openedTo:"2026-10-01"
})}catch(e){wideBlocked=/120 gün/i.test(String(e.message))}
must(wideBlocked,"wide date window not rejected");

console.log(JSON.stringify({
 ok:true,observedCbsSchema:true,observedPartySchema:true,exactPartyMatch:true,
 clearPartyNameNotStored:true,dateWindowApplied:true,activeSearchDedup:true,
 unrelatedCasesNotPersisted:true,noDocumentList:true,noPdfQueue:true,manualDownloadPausePreserved:true,
 maxWindowDays:120,maxCandidates:50
}));
try{db.close()}catch{}
fs.rmSync(root,{recursive:true,force:true});
