'use strict';
const crypto=require('node:crypto');
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const cbsAdapter=require("./uyap_cbs_list_adapter");
const caseContract=require("./uyap_case_document_contract");
const capabilityContract=require("./uyap_query_capability_contract");
const TYPES=new Set(['document.list','case.search','case.units','cbs.provinces','cbs.units','cbs.search','case.details','case.parties','hearing.search','document.pdf','document.viewer_params']);
const schema=`
CREATE TABLE IF NOT EXISTS uyap_query_policy(id INTEGER PRIMARY KEY CHECK(id=1),state TEXT NOT NULL,migration_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS uyap_query_history(command_id INTEGER PRIMARY KEY REFERENCES uyap_command_queue(id),operation TEXT NOT NULL,case_id INTEGER,created_at TEXT,legacy INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS uyap_query_events(id INTEGER PRIMARY KEY,command_id INTEGER NOT NULL REFERENCES uyap_query_history(command_id),state TEXT NOT NULL,occurred_at TEXT NOT NULL DEFAULT(datetime('now')),error_code TEXT,result_ref TEXT,UNIQUE(command_id,state));
CREATE TABLE IF NOT EXISTS uyap_command_retirements(command_id INTEGER PRIMARY KEY REFERENCES uyap_command_queue(id),migration_id TEXT NOT NULL,reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS uyap_case_query_bindings(case_id INTEGER PRIMARY KEY,binding_hash TEXT NOT NULL,evidence_ref TEXT NOT NULL,adapter TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS uyap_user_actions(request_key TEXT PRIMARY KEY,case_id INTEGER NOT NULL,refresh INTEGER NOT NULL,command_id INTEGER,state TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')),scope_hash TEXT);
CREATE TABLE IF NOT EXISTS uyap_command_grants(command_id INTEGER PRIMARY KEY REFERENCES uyap_command_queue(id),request_key TEXT NOT NULL REFERENCES uyap_user_actions(request_key),case_id INTEGER NOT NULL,binding_hash TEXT NOT NULL,expires_ms INTEGER NOT NULL,kind TEXT NOT NULL DEFAULT 'query',payload_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS uyap_document_query_proofs(remote_id INTEGER PRIMARY KEY,case_id INTEGER NOT NULL,binding_hash TEXT NOT NULL,document_hash TEXT NOT NULL,command_id INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS uyap_retired_no_revival BEFORE UPDATE OF status ON uyap_command_queue WHEN EXISTS(SELECT 1 FROM uyap_command_retirements r WHERE r.command_id=OLD.id) AND NEW.status!='archived' BEGIN SELECT RAISE(ABORT,'retired_command'); END;
CREATE TRIGGER IF NOT EXISTS uyap_retired_no_delete BEFORE DELETE ON uyap_command_queue WHEN EXISTS(SELECT 1 FROM uyap_command_retirements r WHERE r.command_id=OLD.id) BEGIN SELECT RAISE(ABORT,'retired_command'); END;
`;
function ready(db){return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='uyap_query_policy'").get()&&db.prepare('SELECT state FROM uyap_query_policy WHERE id=1').get()?.state==='user_controlled';}
function immutable(db){for(const t of ['uyap_query_history','uyap_query_events','uyap_command_retirements','uyap_command_grants'])for(const op of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS ${t}_no_${op.toLowerCase()} BEFORE ${op} ON ${t} BEGIN SELECT RAISE(ABORT,'immutable_query_audit'); END;`);}
function event(db,id,state,error=null,ref=null,at=null){db.prepare("INSERT OR IGNORE INTO uyap_query_events(command_id,state,error_code,result_ref,occurred_at) VALUES(?,?,?,?,COALESCE(?,datetime('now')))").run(id,state,error,ref,at);}
function target(db,p){let id=Number(p?.context?.caseId);return Number.isSafeInteger(id)&&id>0&&db.prepare('SELECT id FROM cases WHERE id=?').get(id)?id:null;}
function migrate(db,{expectedQueued,backupManifest,migrationId='legacy-discovery-v1',afterRow}={}){
 if(!Number.isSafeInteger(Number(expectedQueued))||Number(expectedQueued)<0)throw Error('fresh_queue_count_required');expectedQueued=Number(expectedQueued);
 if(!backupManifest||backupManifest.schema!==1||backupManifest.verified!==true)throw Error('verified_backup_required');
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='uyap_query_policy'").get()){
  const rows=db.prepare('SELECT r.command_id,q.status FROM uyap_command_retirements r JOIN uyap_command_queue q ON q.id=r.command_id WHERE r.migration_id=? ORDER BY r.command_id').all(migrationId);
  if(rows.length!==expectedQueued||rows.some(r=>r.status!=='archived')||digest(rows.map(r=>r.command_id))!==backupManifest.queueIdDigest)throw Error('existing_migration_reconciliation_failed');
  if(!ready(db))throw Error('rollback_hold_requires_separate_reactivation');
  return {alreadyApplied:true,retired:rows.length,queueIdDigest:backupManifest.queueIdDigest};
 }
 db.exec('BEGIN IMMEDIATE');try{
  if(db.prepare("SELECT count(*) n FROM uyap_command_queue WHERE status IN ('running','dispatched')").get().n)throw Error('active_commands');
  const queued=db.prepare("SELECT * FROM uyap_command_queue WHERE status='queued' ORDER BY id").all();
  if(queued.length!==expectedQueued||queued.some(r=>r.command_type!=='fetch_json'||r.attempts!==0||r.dispatched_at||r.finished_at))throw Error('legacy_queue_reconciliation_failed');
  const ids=queued.map(r=>r.id);if(backupManifest.queueIdDigest!==digest(ids))throw Error('backup_queue_mismatch');
  db.exec(schema);immutable(db);
  const add=db.prepare('INSERT OR IGNORE INTO uyap_query_history(command_id,operation,case_id,created_at,legacy) VALUES(?,?,?,?,1)');
  for(const r of db.prepare('SELECT * FROM uyap_command_queue ORDER BY id').all()){
   let p={};try{p=JSON.parse(r.payload_json||'{}')}catch{}
   add.run(r.id,TYPES.has(r.endpoint_key)?r.endpoint_key:'unknown',target(db,p),/^\d{4}-\d{2}-\d{2}[ T][\d:.Z+-]+$/.test(r.created_at||'')?r.created_at:null);
   event(db,r.id,r.attempts>0&&r.dispatched_at?'legacy_attempted_unverified':'never_executed',r.error?'legacy_error_present':null,null,/^\d{4}-\d{2}-\d{2}[ T][\d:.Z+-]+$/.test(r.finished_at||'')?r.finished_at:null);
  }
  for(let i=0;i<queued.length;i++){const r=queued[i];db.prepare('INSERT INTO uyap_command_retirements VALUES(?,?,?)').run(r.id,migrationId,'legacy_never_executed');db.prepare("UPDATE uyap_command_queue SET status='archived' WHERE id=?").run(r.id);event(db,r.id,'archived_never_executed');afterRow?.(i+1);}
  db.prepare("INSERT OR REPLACE INTO uyap_query_policy VALUES(1,'user_controlled',?)").run(migrationId);
  const retired=db.prepare('SELECT count(*) n FROM uyap_command_retirements WHERE migration_id=?').get(migrationId).n;
  if(retired!==expectedQueued||db.prepare("SELECT count(*) n FROM uyap_command_queue WHERE status='queued'").get().n)throw Error('post_migration_reconciliation_failed');
  db.exec('COMMIT');return {alreadyApplied:false,retired,queueIdDigest:digest(ids)};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
function rollbackHold(db){if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='uyap_query_policy'").get())return;db.prepare("UPDATE uyap_query_policy SET state='rollback_hold' WHERE id=1").run();}
function identity(c){return digest([c?.id,c?.uyap_birim_id,c?.court_file_no,c?.uyap_dosya_id,c?.court,c?.case_type]);}

function isCbsCase(c){return /cumhuriyet|başsavc|bassavc|savcılık|savcilik|soruşturma|sorusturma|\bcbs\b/i.test(String(c?.court||"")+" "+String(c?.case_type||""));}
function cbsStatus(c){return /kapalı|kapali|closed|arşiv|arsiv|tamamlan|kesinleş|kesinles/i.test(String(c?.status||""))?1:0;}
function cbsEvidence(db,c){
 if(!isCbsCase(c))throw Error("not_cbs_case");
 const fileNo=caseContract.normalizeFileNo(c?.court_file_no);
 if(!/^20\d{2}\/[1-9]\d*$/.test(fileNo))throw Error("cbs_case_number_required");
 const observationRow=db.prepare(`SELECT id,method,path,status,sample_request_json,last_seen_at FROM uyap_endpoint_observations
   WHERE method='POST' AND path='/avukat_dosya_sorgula_cbs_brd.ajx' AND sample_request_json IS NOT NULL
   ORDER BY last_seen_at DESC,id DESC LIMIT 1`).get();
 if(!observationRow)throw Error("cbs_search_observation_required");
 let request=null;try{request=JSON.parse(observationRow.sample_request_json)}catch{}
 const observation={sourceType:"persisted live observation",reference:"observation:"+observationRow.id,method:observationRow.method,path:observationRow.path,request};
 const unitRows=db.prepare(`SELECT id,payload_json,result_json,finished_at FROM uyap_command_queue
   WHERE endpoint_key='cbs.units' AND status='completed' AND result_json IS NOT NULL
   ORDER BY id DESC`).all();
 const wanted=caseContract.normalizeCourt(c?.court);
 let chosen=null;
 for(const row of unitRows){
   let payload={},data=null;try{payload=JSON.parse(row.payload_json||"{}")}catch{}try{data=JSON.parse(row.result_json||"null")}catch{}
   if(!Array.isArray(data))continue;
   for(const x of data){
     const name=String(x?.birimAdi||x?.ad||"").trim(),id=String(x?.birimId??x?.id??"").trim();
     if(!name||!id||caseContract.normalizeCourt(name)!==wanted)continue;
     const ilKodu=Number(payload?.context?.ilKodu??payload?.body?.ilKodu);
     if(!Number.isInteger(ilKodu)||ilKodu<1||ilKodu>81)continue;
     chosen={sourceType:"completed cbs.units",reference:"command:"+row.id,birimId:id,birimAdi:name,ilKodu,finishedAt:row.finished_at||null};break;
   }
   if(chosen)break;
 }
 if(!chosen)throw Error("cbs_unit_evidence_required");
 const status=cbsStatus(c);
 const prepared=cbsAdapter.prepareCbsList({observation,unit:chosen,status,page:1});
 const target={birimId:chosen.birimId,dosyaNo:fileNo,dosyaId:String(c?.uyap_dosya_id||"").trim()||null};
 return {observation,unit:chosen,status,target,prepared};
}
function cbsScopeHash(c,e){return digest([c?.id,c?.court,c?.court_file_no,c?.status,e.unit.birimId,e.unit.ilKodu,e.status,e.observation.reference,e.unit.reference]);}
function certifyBinding(db,proof){
 if(!ready(db))throw Error('migration_required');
 const c=db.prepare('SELECT * FROM cases WHERE id=?').get(Number(proof.caseId));
 if(!c||proof.kind!=='verified_portal_binding'||proof.adapter!=='court_documents_v1'||!/^observation:[a-f0-9-]{36}$/i.test(proof.evidenceRef||'')||!UUID.test(proof.evidenceRef.slice(12)))throw Error('verified_evidence_required');
 if(String(c.uyap_birim_id)!==String(proof.unitId)||c.court_file_no!==proof.caseNo||String(c.uyap_dosya_id)!==String(proof.dosyaId)||!c.uyap_birim_id||!c.uyap_dosya_id)throw Error('case_binding_mismatch');
 require('../extension/observation_contracts').assertImportAllowed(c);
 if(!/mahkem/i.test(c.court||''))throw Error('unsupported_case_type');
 db.prepare('INSERT OR REPLACE INTO uyap_case_query_bindings VALUES(?,?,?,?)').run(c.id,identity(c),proof.evidenceRef,proof.adapter);
 return {caseId:c.id,adapter:proof.adapter};
}
function install(db,uyap){
 let consent=null;
 const caseRow=id=>{const c=db.prepare("SELECT * FROM cases WHERE id=?").get(Number(id));if(!c)throw Error("case_not_found");return c;};
 const bound=id=>{const c=caseRow(id);require("../extension/observation_contracts").assertImportAllowed(c);if(!/mahkem/i.test(c.court||""))throw Error("unsupported_case_type");const b=db.prepare("SELECT * FROM uyap_case_query_bindings WHERE case_id=?").get(c.id);if(!b||b.adapter!=="court_documents_v1"||b.binding_hash!==identity(c))throw Error("case_binding_verification_required");return {c,b};};
 const rootForRequest=key=>Number(db.prepare("SELECT command_id FROM uyap_user_actions WHERE request_key=?").get(key)?.command_id||0)||null;
 const grant=id=>db.prepare("SELECT q.*,g.case_id,g.binding_hash,g.kind,g.payload_hash,g.expires_ms,g.request_key FROM uyap_command_queue q JOIN uyap_command_grants g ON g.command_id=q.id WHERE q.id=?").get(id);
 const safeEvent=(id,state,error=null,ref=null)=>{if(id&&db.prepare("SELECT 1 FROM uyap_query_history WHERE command_id=?").get(id))event(db,id,state,error,ref);};
 const fail=(id,reason)=>{const g=grant(id),root=g?.kind==="cbs_case_list"?rootForRequest(g.request_key):id;db.prepare("UPDATE uyap_command_queue SET status='failed',finished_at=datetime('now'),error=? WHERE id=? AND status IN ('queued','running')").run(reason,id);safeEvent(root,reason==="execution_unknown"?"execution_unknown":"failed",reason);if(g?.request_key)db.prepare("UPDATE uyap_user_actions SET state='failed' WHERE request_key=?").run(g.request_key);};
 function contract(kind){
   const key=kind==="download"?"document.pdf":kind==="cbs_case_list"?"cbs.search":"document.list";
   const e=db.prepare("SELECT method,host,path,enabled FROM uyap_endpoints WHERE endpoint_key=?").get(key);
   if(kind==="download")return e?.enabled===1&&e.method==="GET"&&e.host==="vatandas.uyap.gov.tr"&&e.path==="/view_document_brd.uyap";
   if(kind==="cbs_case_list")return e?.enabled===1&&e.method==="POST"&&e.host==="avukat.uyap.gov.tr"&&e.path==="/avukat_dosya_sorgula_cbs_brd.ajx";
   return e?.enabled===1&&e.method==="POST"&&e.host==="avukat.uyap.gov.tr"&&e.path==="/list_dosya_evraklar.ajx";
 }
 function scope(kind,caseId){
   if(kind==="cbs_case_list"){const c=caseRow(caseId),e=cbsEvidence(db,c);return {c,e,hash:cbsScopeHash(c,e)};}
   const x=bound(caseId);return {c:x.c,b:x.b,hash:x.b.binding_hash};
 }
 function validGrant(r){
   if(!r||!contract(r.kind)||digest(r.payload_json)!==r.payload_hash||r.expires_ms<Date.now())return false;
   const s=scope(r.kind,r.case_id);if(s.hash!==r.binding_hash)return false;
   if(r.kind==="download")downloadProof(r.case_id,JSON.parse(r.payload_json).context.remoteDocumentDbId);
   if(r.kind==="cbs_case_list"){const p=JSON.parse(r.payload_json||"{}"),ctx=p.context||{};if(ctx.explicitCbsCaseLookup!==true||Number(ctx.caseId)!==Number(r.case_id)||String(ctx.cbsScopeHash)!==r.binding_hash)return false;}
   return true;
 }
 function enqueueCbsPage(c,e,key,hash,page,rootCommandId=null){
   const prepared=cbsAdapter.prepareCbsList({observation:e.observation,unit:e.unit,status:e.status,page});
   consent={key,caseId:c.id,hash,kind:"cbs_case_list",rootCommandId};
   try{return uyap.enqueue({commandType:"fetch_json",endpointKey:"cbs.search",priority:6,payload:{query:prepared.query,body:prepared.body,context:{explicitCbsCaseLookup:true,caseId:c.id,requestKey:key,cbsScopeHash:hash,birimId:e.unit.birimId,ilKodu:e.unit.ilKodu,dosyaDurumKod:e.status,pageNumber:page,pageSize:500,rootCommandId:rootCommandId||null,observationRef:e.observation.reference,unitRef:e.unit.reference}}});}
   finally{consent=null;}
 }
 function cbsPages(requestKey){
   const sql="SELECT q.id,q.payload_json,q.result_json FROM uyap_command_queue q JOIN uyap_command_grants g ON g.command_id=q.id WHERE g.request_key=? AND g.kind='cbs_case_list' AND q.status='completed' AND q.result_json IS NOT NULL ORDER BY CAST(json_extract(q.payload_json,'$.context.pageNumber') AS INTEGER),q.id";
   return db.prepare(sql).all(requestKey).map(r=>{const p=JSON.parse(r.payload_json||"{}");return {context:{birimId:String(p.context?.birimId||""),status:Number(p.context?.dosyaDurumKod),page:Number(p.context?.pageNumber),pageSize:500},data:JSON.parse(r.result_json),reference:"command:"+r.id};});
 }
 const guard={
  beforeEnqueue(input){
   if(!ready(db))throw Error("migration_required");
   const kind=consent?.kind||"query",ctx=input.payload?.context||{};
   const valid=!!consent&&(kind==="download"?input.commandType==="download_document"&&input.endpointKey==="document.pdf"&&consent.documents.has(Number(ctx.remoteDocumentDbId)):kind==="cbs_case_list"?input.commandType==="fetch_json"&&input.endpointKey==="cbs.search"&&ctx.explicitCbsCaseLookup===true&&String(ctx.cbsScopeHash)===consent.hash:input.commandType==="fetch_json"&&input.endpointKey==="document.list");
   if(!valid||!contract(kind)||Number(ctx.caseId)!==consent.caseId)throw Error("explicit_supported_user_query_required");
   if(db.prepare("SELECT count(*) n FROM uyap_command_queue WHERE status IN ('queued','running')").get().n>=200)throw Error("active_command_limit");
  },
  onEnqueue(id){
   const kind=consent.kind||"query",payloadHash=digest(db.prepare("SELECT payload_json FROM uyap_command_queue WHERE id=?").get(id).payload_json);
   db.prepare("INSERT INTO uyap_command_grants VALUES(?,?,?,?,?,?,?)").run(id,consent.key,consent.caseId,consent.hash,Date.now()+10*60*1000,kind,payloadHash);
   if(kind==="cbs_case_list"){if(!consent.rootCommandId){consent.rootCommandId=id;db.prepare("INSERT INTO uyap_query_history VALUES(?,?,?,?,0)").run(id,"cbs.search",consent.caseId,new Date().toISOString());event(db,id,"queued");}}
   else{db.prepare("INSERT INTO uyap_query_history VALUES(?,?,?,?,0)").run(id,kind==="download"?"document.pdf":"document.list",consent.caseId,new Date().toISOString());event(db,id,"queued");}
  },
  beforeClaim(){
   if(!ready(db))return {wait:true,reason:"migration_required"};
   for(const r of db.prepare("SELECT q.id,q.status,q.dispatched_at,q.attempts,q.payload_json,g.* FROM uyap_command_queue q JOIN uyap_command_grants g ON g.command_id=q.id WHERE q.status IN ('queued','running')").all()){
     let valid=true;try{valid=validGrant(r)}catch{valid=false}
     if(!valid)fail(r.id,"case_binding_changed");
     else if(r.status==="running"&&(r.expires_ms<Date.now()||Date.parse((r.dispatched_at||"").replace(" ","T")+"Z")<Date.now()-180000))fail(r.id,"execution_unknown");
     else if(r.status==="queued"&&(r.expires_ms<Date.now()||r.attempts>0))fail(r.id,"user_action_expired");
   }
   return null;
  },
  selectionSql:"AND q.attempts=0 AND EXISTS(SELECT 1 FROM uyap_command_grants g WHERE g.command_id=q.id) AND NOT EXISTS(SELECT 1 FROM uyap_command_retirements r WHERE r.command_id=q.id)",
  onClaim(id){const r=grant(id);if(!validGrant(r))throw Error("grant_changed_before_claim");safeEvent(r.kind==="cbs_case_list"?rootForRequest(r.request_key):id,"running");},
  beforeResult(id,result){
   if(!ready(db))return {ok:false,reason:"migration_required"};
   const r=grant(id);if(!r||r.status!=="running"||db.prepare("SELECT 1 FROM uyap_command_retirements WHERE command_id=?").get(id))return {ok:false,reason:"inactive_user_command"};
   if(r.expires_ms<Date.now()){fail(id,"execution_unknown");return {ok:false,reason:"execution_unknown"};}
   try{if(!validGrant(r))throw Error()}catch{fail(id,"case_binding_changed");return {ok:false,reason:"case_binding_changed"};}
   if(r.kind==="download"){if(result.ok&&!/application\/pdf/i.test(String(result.contentType||""))){fail(id,"document_content_unverified");return {ok:false,reason:"document_content_unverified"};}try{downloadProof(r.case_id,JSON.parse(r.payload_json).context.remoteDocumentDbId);return null;}catch{fail(id,"document_binding_changed");return {ok:false,reason:"document_binding_changed"};}}
   const denied=require("../extension/observation_contracts").applicationError(result.data);if(denied){fail(id,"uyap_application_denied");return {ok:false,reason:"uyap_application_denied"};}
   if(r.kind==="cbs_case_list"){if(result.ok&&Number(result.status)>=200&&Number(result.status)<400&&(!Array.isArray(result.data)||result.data.length!==2||!Array.isArray(result.data[0])||!Number.isSafeInteger(result.data[1]))){fail(id,"cbs_response_unverified");return {ok:false,reason:"cbs_response_unverified"};}return null;}
   const c=bound(r.case_id).c;
   if(result.ok&&Number(result.status)>=200&&Number(result.status)<400&&!denied){const a=result.data?.tumEvraklar;if(!Array.isArray(a)||a.some(d=>!d||String(d.dosyaId)!==String(c.uyap_dosya_id)||!d.evrakId)){fail(id,"document_ownership_unverified");return {ok:false,reason:"document_ownership_unverified"};}}
   return null;
  },
  afterResult(id,result){
   const q=db.prepare("SELECT status FROM uyap_command_queue WHERE id=?").get(id),g=grant(id);
   if(g?.kind==="cbs_case_list"){
     const root=rootForRequest(g.request_key);if(q.status!=="completed"){fail(id,"query_failed");return;}
     try{
       const c=caseRow(g.case_id),e=cbsEvidence(db,c),hash=cbsScopeHash(c,e);if(hash!==g.binding_hash)throw Error("case_binding_changed");
       const selection=cbsAdapter.selectCbsTarget({target:e.target,pages:cbsPages(g.request_key)});
       if(selection.state==="incomplete"&&selection.nextPage){enqueueCbsPage(c,e,g.request_key,hash,selection.nextPage,root);return;}
       if(selection.state==="found"&&selection.identity){
         const check=caseContract.verifyCaseIdentity({court:c.court,fileNo:c.court_file_no,uyapDosyaId:c.uyap_dosya_id||null},{birimAdi:e.unit.birimAdi,dosyaNo:selection.identity.dosyaNo,dosyaId:selection.identity.dosyaId},{source:"cbs_unit_status_list:"+selection.identity.sourceReference,liveObserved:true});
         if(!check.verified)throw Error(check.reason||"cbs_identity_unverified");
         let meta={};try{meta=JSON.parse(c.uyap_metadata_json||"{}")}catch{}
         meta={...meta,cbsIdentityEvidence:{adapter:"cbs_unit_status_exact_v1",observationRef:e.observation.reference,unitRef:e.unit.reference,resultRef:selection.identity.sourceReference,verifiedAt:new Date().toISOString(),documentOwnershipVerified:false}};
         db.prepare("UPDATE cases SET uyap_dosya_id=?,uyap_birim_id=?,uyap_metadata_json=?,synced_at=datetime('now') WHERE id=?").run(selection.identity.dosyaId,e.unit.birimId,JSON.stringify(meta),c.id);
         const updated=caseRow(c.id);
         db.prepare("INSERT OR REPLACE INTO uyap_case_query_bindings VALUES(?,?,?,?)").run(c.id,identity(updated),JSON.stringify({observationRef:e.observation.reference,unitRef:e.unit.reference,resultRef:selection.identity.sourceReference}),"cbs_unit_status_exact_v1");
         db.prepare("UPDATE uyap_user_actions SET state='completed' WHERE request_key=?").run(g.request_key);safeEvent(root,"completed",null,"command:"+id);return;
       }
       const terminal=selection.state==="ambiguous"?"ambiguous":selection.state==="identity_mismatch"?"identity_mismatch":"not_found";
       db.prepare("UPDATE uyap_user_actions SET state=? WHERE request_key=?").run(terminal,g.request_key);safeEvent(root,terminal,terminal);
     }catch(e){db.prepare("UPDATE uyap_user_actions SET state='failed' WHERE request_key=?").run(g.request_key);safeEvent(root,"failed",String(e.message||e));}
     return;
   }
   if(q.status==="completed"){event(db,id,"completed",null,"command:"+id);if(g.kind==="query"){const ids=new Set((result.data?.tumEvraklar||[]).map(d=>String(d.evrakId)));for(const d of db.prepare("SELECT * FROM uyap_remote_documents WHERE case_id=?").all(g.case_id)){if(!ids.has(String(d.remote_document_id)))continue;db.prepare("INSERT OR REPLACE INTO uyap_document_query_proofs VALUES(?,?,?,?,?)").run(d.id,g.case_id,g.binding_hash,documentHash(d),id);}}}
   else{if(q.status==="queued")fail(id,"retry_requires_user_action");else fail(id,"query_failed");}
  },
  resultFailure(id){if(ready(db)&&db.prepare("SELECT 1 FROM uyap_command_grants WHERE command_id=?").get(id))fail(id,"query_processing_failed");},
  automaticRecoveryAllowed:false,
  allowSessionRecovery(source){return source==="successful_network_observation:/get_avukat_id.ajx"&&pending().pending;}
 };
 uyap.setRuntimePolicy(guard);
 function documentHash(d){const m=JSON.parse(d.metadata_json||"{}");return digest([d.case_id,d.remote_document_id,m.dosyaId,m.evrakId]);}
 function downloadProof(caseId,id){const {c,b}=bound(caseId),d=db.prepare("SELECT * FROM uyap_remote_documents WHERE id=? AND case_id=?").get(Number(id),c.id),p=db.prepare("SELECT * FROM uyap_document_query_proofs WHERE remote_id=? AND case_id=?").get(Number(id),c.id);if(!d||!p||p.binding_hash!==b.binding_hash||p.document_hash!==documentHash(d))throw Error("document_binding_verification_required");return d;}
 function beginCbs(c,{requestKey,refresh}){
   const e=cbsEvidence(db,c),hash=cbsScopeHash(c,e);db.exec("BEGIN IMMEDIATE");
   try{
     const old=db.prepare("SELECT * FROM uyap_user_actions WHERE request_key=?").get(requestKey);if(old){if(old.case_id!==c.id||old.refresh!==Number(refresh)||old.state==="download_approved")throw Error("idempotency_conflict");db.exec("COMMIT");return {commandId:old.command_id,state:old.state,reused:true,adapter:"cbs_unit_status_exact_v1"};}
     const active=db.prepare("SELECT a.command_id FROM uyap_user_actions a WHERE a.case_id=? AND EXISTS(SELECT 1 FROM uyap_command_grants g JOIN uyap_command_queue q ON q.id=g.command_id WHERE g.request_key=a.request_key AND g.kind='cbs_case_list' AND g.binding_hash=? AND q.status IN ('queued','running')) ORDER BY a.rowid DESC LIMIT 1").get(c.id,hash);
     const cached=!refresh?db.prepare("SELECT h.command_id FROM uyap_query_history h JOIN uyap_command_grants g ON g.command_id=h.command_id JOIN uyap_query_events e2 ON e2.command_id=h.command_id AND e2.state='completed' WHERE h.case_id=? AND g.kind='cbs_case_list' AND g.binding_hash=? AND h.created_at>datetime('now','-15 minutes') ORDER BY h.command_id DESC LIMIT 1").get(c.id,hash):null;
     if(active||cached){const id=Number((active||cached).command_id),state=active?"existing_pending":"cache_hit";db.prepare("INSERT INTO uyap_user_actions(request_key,case_id,refresh,command_id,state) VALUES(?,?,?,?,?)").run(requestKey,c.id,Number(refresh),id,state);db.exec("COMMIT");return {commandId:id,state,reused:true,adapter:"cbs_unit_status_exact_v1"};}
     db.prepare("INSERT INTO uyap_user_actions(request_key,case_id,refresh,state,scope_hash) VALUES(?,?,?,'queued',?)").run(requestKey,c.id,Number(refresh),hash);
     const id=enqueueCbsPage(c,e,requestKey,hash,1,null);db.prepare("UPDATE uyap_user_actions SET command_id=? WHERE request_key=?").run(id,requestKey);db.exec("COMMIT");
     return {commandId:id,state:"queued",reused:false,adapter:"cbs_unit_status_exact_v1",status:e.status,unit:{birimId:e.unit.birimId,birimAdi:e.unit.birimAdi}};
   }catch(e){db.exec("ROLLBACK");throw e;}
 }
 function begin(caseId,{requestKey,refresh=false}={}){
  if(!ready(db))throw Error("migration_required");if(!UUID.test(requestKey||"")||typeof refresh!=="boolean")throw Error("user_action_key_required");if(uyap.executionHeld())throw Error("local_return_hold");
  const c=caseRow(caseId);if(isCbsCase(c))return beginCbs(c,{requestKey,refresh});
  const {b}=bound(caseId);db.exec("BEGIN IMMEDIATE");
  try{
   const old=db.prepare("SELECT * FROM uyap_user_actions WHERE request_key=?").get(requestKey);if(old){if(old.case_id!==c.id||old.refresh!==Number(refresh)||old.state==="download_approved")throw Error("idempotency_conflict");db.exec("COMMIT");return {commandId:old.command_id,state:old.state,reused:true};}
   const active=db.prepare("SELECT q.id FROM uyap_command_queue q JOIN uyap_command_grants g ON g.command_id=q.id WHERE g.case_id=? AND g.binding_hash=? AND g.kind='query' AND q.status IN ('queued','running')").get(c.id,b.binding_hash);
   const cached=!refresh?db.prepare("SELECT q.id FROM uyap_command_queue q JOIN uyap_command_grants g ON g.command_id=q.id JOIN uyap_query_events e ON e.command_id=q.id AND e.state='completed' WHERE g.case_id=? AND g.binding_hash=? AND g.kind='query' AND q.status='completed' AND q.finished_at>datetime('now','-15 minutes') ORDER BY q.id DESC LIMIT 1").get(c.id,b.binding_hash):null;
   if(active||cached){const id=(active||cached).id,state=active?"existing_pending":"cache_hit";db.prepare("INSERT INTO uyap_user_actions(request_key,case_id,refresh,command_id,state) VALUES(?,?,?,?,?)").run(requestKey,c.id,Number(refresh),id,state);db.exec("COMMIT");return {commandId:id,state,reused:true};}
   db.prepare("INSERT INTO uyap_user_actions(request_key,case_id,refresh,state) VALUES(?,?,?,'queued')").run(requestKey,c.id,Number(refresh));consent={key:requestKey,caseId:c.id,hash:b.binding_hash};
   const id=uyap.enqueueCaseDocumentSync(c.id,{priority:6,purpose:"explicit_user_query",source:"case_query_button"});if(!db.prepare("SELECT 1 FROM uyap_command_grants WHERE command_id=? AND request_key=?").get(id,requestKey))throw Error("unmanaged_active_command");
   db.prepare("UPDATE uyap_user_actions SET command_id=? WHERE request_key=?").run(id,requestKey);db.exec("COMMIT");return {commandId:id,state:"queued",reused:false};
  }catch(e){db.exec("ROLLBACK");throw e;}finally{consent=null;}
 }
 function beginDownloads(caseId,{requestKey,documentIds,confirmed=false}={}){
  if(!ready(db)||uyap.executionHeld())throw Error("migration_or_hold");if(!confirmed||!UUID.test(requestKey||"")||!Array.isArray(documentIds)||!documentIds.length||documentIds.length>200||new Set(documentIds).size!==documentIds.length)throw Error("explicit_document_selection_required");
  if(isCbsCase(caseRow(caseId)))throw Error("cbs_document_ownership_not_verified");
  const {c,b}=bound(caseId);for(const id of documentIds)downloadProof(c.id,id);db.exec("BEGIN IMMEDIATE");
  try{const old=db.prepare("SELECT * FROM uyap_user_actions WHERE request_key=?").get(requestKey);if(old){if(old.case_id!==c.id||old.state!=="download_approved"||old.scope_hash!==digest([...documentIds].map(Number).sort((a,b)=>a-b)))throw Error("idempotency_conflict");db.exec("COMMIT");return {commandIds:db.prepare("SELECT command_id FROM uyap_command_grants WHERE request_key=?").all(requestKey).map(x=>x.command_id),reused:true};}
   db.prepare("INSERT INTO uyap_user_actions(request_key,case_id,refresh,state,scope_hash) VALUES(?,?,0,'download_approved',?)").run(requestKey,c.id,digest([...documentIds].map(Number).sort((a,b)=>a-b)));consent={key:requestKey,caseId:c.id,hash:b.binding_hash,kind:"download",documents:new Set(documentIds.map(Number))};const ids=[];for(const id of documentIds){const command=uyap.enqueueRemoteDocumentDownload(id);if(command)ids.push(command);}if(ids.length)db.prepare("UPDATE uyap_user_actions SET command_id=? WHERE request_key=?").run(ids[0],requestKey);db.exec("COMMIT");return {commandIds:ids,manualDownloadPaused:uyap.sessionState().manualDownloadPaused};
  }catch(e){db.exec("ROLLBACK");throw e;}finally{consent=null;}
 }
 function downloadOptions(caseId){if(!ready(db))return [];if(isCbsCase(caseRow(caseId)))return [];bound(caseId);return db.prepare("SELECT d.id FROM uyap_remote_documents d JOIN uyap_document_query_proofs p ON p.remote_id=d.id WHERE d.case_id=? AND d.status='discovered' AND d.local_asset_id IS NULL LIMIT 200").all(Number(caseId)).filter(d=>{try{downloadProof(caseId,d.id);return true;}catch{return false;}});}
 function history(caseId,options={}){if(!ready(db)&&!db.prepare("SELECT 1 FROM sqlite_master WHERE name='uyap_query_history'").get())return [];return db.prepare("SELECT h.command_id,h.operation,h.case_id,h.created_at,h.legacy,e.state,e.occurred_at,e.error_code,e.result_ref FROM uyap_query_history h JOIN uyap_query_events e ON e.id=(SELECT max(x.id) FROM uyap_query_events x WHERE x.command_id=h.command_id) WHERE (? IS NULL OR h.case_id=?) AND h.command_id<? ORDER BY h.command_id DESC LIMIT ?").all(caseId==null?null:Number(caseId),caseId==null?null:Number(caseId),Number(options.beforeId)||Number.MAX_SAFE_INTEGER,Math.max(1,Math.min(200,Number(options.limit)||100));}
 function status(caseId){
  if(!ready(db))return {supported:false,reason:"migration_required",contractVersion:"uyap.query-support.integration.v1",capabilityContractVersion:capabilityContract.CONTRACT_VERSION};
  const c=caseRow(caseId),caseKind=capabilityContract.classifyCaseKind(c);
  if(isCbsCase(c)){try{const e=cbsEvidence(db,c);return {supported:true,operation:"cbs.search",adapter:"cbs_unit_status_exact_v1",flowId:"unit_status_list_local_exact_match",caseKind,documentBindingAllowed:false,status:e.status,unit:{birimId:e.unit.birimId,birimAdi:e.unit.birimAdi},history:history(caseId),contractVersion:"uyap.query-support.integration.v1",capabilityContractVersion:capabilityContract.CONTRACT_VERSION};}catch(e){return {supported:false,reason:e.message,caseKind,flowId:"unit_status_list_local_exact_match",documentBindingAllowed:false,history:history(caseId),contractVersion:"uyap.query-support.integration.v1",capabilityContractVersion:capabilityContract.CONTRACT_VERSION};}}
  try{bound(caseId);return {supported:true,operation:"document.list",adapter:"court_documents_v1",caseKind,history:history(caseId),contractVersion:"uyap.query-support.integration.v1",capabilityContractVersion:capabilityContract.CONTRACT_VERSION};}catch(e){return {supported:false,reason:e.message,caseKind,history:history(caseId),contractVersion:"uyap.query-support.integration.v1",capabilityContractVersion:capabilityContract.CONTRACT_VERSION};}
 }
 function pending(){if(!ready(db)||uyap.executionHeld())return {pending:false};const r=db.prepare("SELECT a.request_key FROM uyap_command_grants g JOIN uyap_command_queue q ON q.id=g.command_id JOIN uyap_user_actions a ON a.request_key=g.request_key WHERE q.status='queued' AND q.attempts=0 AND g.expires_ms>? AND (g.kind IN ('query','cbs_case_list') OR ?=0) ORDER BY a.rowid DESC LIMIT 1").get(Date.now(),Number(uyap.sessionState().manualDownloadPaused));return {pending:!!r,actionId:r?.request_key};}
 return {begin,beginDownloads,downloadOptions,history,status,pending,downloadPause(paused){if(!ready(db)||uyap.executionHeld())throw Error("migration_or_hold");return uyap.setManualDownloadPause(paused);}};
}
module.exports={install,migrate,rollbackHold,certifyBinding,ready,digest};
