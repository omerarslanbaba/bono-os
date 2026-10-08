'use strict';
const crypto=require('node:crypto');
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const cbsAdapter=require("./uyap_cbs_list_adapter");
const caseContract=require("./uyap_case_document_contract");
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
function cbsScopeHash(c,e){return digest([c?.id,c?.court,c?.court_file_no,c?.status,c?.uyap_dosya_id||null,e.unit.birimId,e.unit.ilKodu,e.status,e.observation.reference,e.unit.reference]);}
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
 const bound=id=>{const c=db.prepare('SELECT * FROM cases WHERE id=?').get(Number(id));if(!c)throw Error('case_not_found');require('../extension/observation_contracts').assertImportAllowed(c);if(!/mahkem/i.test(c.court||''))throw Error('unsupported_case_type');const b=db.prepare('SELECT * FROM uyap_case_query_bindings WHERE case_id=?').get(c.id);if(!b||b.adapter!=='court_documents_v1'||b.binding_hash!==identity(c))throw Error('case_binding_verification_required');return {c,b};};
 const fail=(id,reason)=>{db.prepare("UPDATE uyap_command_queue SET status='failed',finished_at=datetime('now'),error=? WHERE id=? AND status IN ('queued','running')").run(reason,id);event(db,id,reason==='execution_unknown'?'execution_unknown':'failed',reason);};
 function contract(kind){const key=kind==='download'?'document.pdf':'document.list',e=db.prepare('SELECT method,host,path,enabled FROM uyap_endpoints WHERE endpoint_key=?').get(key);return e?.enabled===1&&e.method===(kind==='download'?'GET':'POST')&&e.host===(kind==='download'?'vatandas.uyap.gov.tr':'avukat.uyap.gov.tr')&&e.path===(kind==='download'?'/view_document_brd.uyap':'/list_dosya_evraklar.ajx');}
 const guard={
  beforeEnqueue(input){if(!ready(db))throw Error('migration_required');const valid=consent&&(consent.kind==='download'?input.commandType==='download_document'&&input.endpointKey==='document.pdf'&&consent.documents.has(Number(input.payload?.context?.remoteDocumentDbId)):input.commandType==='fetch_json'&&input.endpointKey==='document.list');if(!valid||!contract(consent.kind)||Number(input.payload?.context?.caseId)!==consent.caseId)throw Error('explicit_supported_user_query_required');if(db.prepare("SELECT count(*) n FROM uyap_command_queue WHERE status IN ('queued','running')").get().n>=200)throw Error('active_command_limit');},
  onEnqueue(id){db.prepare('INSERT INTO uyap_command_grants VALUES(?,?,?,?,?,?,?)').run(id,consent.key,consent.caseId,consent.hash,Date.now()+10*60*1000,consent.kind||'query',digest(db.prepare('SELECT payload_json FROM uyap_command_queue WHERE id=?').get(id).payload_json));db.prepare('INSERT INTO uyap_query_history VALUES(?,?,?,?,0)').run(id,consent.kind==='download'?'document.pdf':'document.list',consent.caseId,new Date().toISOString());event(db,id,'queued');},
  beforeClaim(){if(!ready(db))return {wait:true,reason:'migration_required'};for(const r of db.prepare("SELECT q.id,q.status,q.dispatched_at,q.attempts,q.payload_json,g.* FROM uyap_command_queue q JOIN uyap_command_grants g ON g.command_id=q.id WHERE q.status IN ('queued','running')").all()){let valid=true;try{valid=contract(r.kind)&&digest(r.payload_json)===r.payload_hash&&bound(r.case_id).b.binding_hash===r.binding_hash;if(valid&&r.kind==='download')downloadProof(r.case_id,JSON.parse(r.payload_json).context.remoteDocumentDbId)}catch{valid=false}if(!valid)fail(r.id,'case_binding_changed');else if(r.status==='running'&&(r.expires_ms<Date.now()||Date.parse((r.dispatched_at||'').replace(' ','T')+'Z')<Date.now()-180000))fail(r.id,'execution_unknown');else if(r.status==='queued'&&(r.expires_ms<Date.now()||r.attempts>0))fail(r.id,'user_action_expired');}return null;},
  selectionSql:"AND q.attempts=0 AND EXISTS(SELECT 1 FROM uyap_command_grants g WHERE g.command_id=q.id) AND NOT EXISTS(SELECT 1 FROM uyap_command_retirements r WHERE r.command_id=q.id)",
  onClaim(id){const r=db.prepare('SELECT q.payload_json,g.* FROM uyap_command_queue q JOIN uyap_command_grants g ON g.command_id=q.id WHERE q.id=?').get(id);if(!r||!contract(r.kind)||digest(r.payload_json)!==r.payload_hash||r.expires_ms<Date.now()||bound(r.case_id).b.binding_hash!==r.binding_hash)throw Error('grant_changed_before_claim');event(db,id,'running');},
  beforeResult(id,result){if(!ready(db))return {ok:false,reason:'migration_required'};const r=db.prepare('SELECT q.*,g.case_id,g.binding_hash,g.kind,g.payload_hash,g.expires_ms FROM uyap_command_queue q JOIN uyap_command_grants g ON g.command_id=q.id WHERE q.id=?').get(id);if(!r||r.status!=='running'||db.prepare('SELECT 1 FROM uyap_command_retirements WHERE command_id=?').get(id))return {ok:false,reason:'inactive_user_command'};
   if(r.expires_ms<Date.now()){fail(id,'execution_unknown');return {ok:false,reason:'execution_unknown'};}
   let c;try{if(!contract(r.kind)||digest(r.payload_json)!==r.payload_hash)throw Error();const x=bound(r.case_id);if(x.b.binding_hash!==r.binding_hash)throw Error();c=x.c;}catch{fail(id,'case_binding_changed');return {ok:false,reason:'case_binding_changed'};}
   if(r.kind==='download'){if(result.ok&&!/application\/pdf/i.test(String(result.contentType||''))){fail(id,'document_content_unverified');return {ok:false,reason:'document_content_unverified'};}try{downloadProof(r.case_id,JSON.parse(r.payload_json).context.remoteDocumentDbId);return null;}catch{fail(id,'document_binding_changed');return {ok:false,reason:'document_binding_changed'};}}
   const denied=require('../extension/observation_contracts').applicationError(result.data);if(denied){fail(id,'uyap_application_denied');return {ok:false,reason:'uyap_application_denied'};}
   if(result.ok&&Number(result.status)>=200&&Number(result.status)<400&&!denied){const a=result.data?.tumEvraklar;if(!Array.isArray(a)||a.some(d=>!d||String(d.dosyaId)!==String(c.uyap_dosya_id)||!d.evrakId)){fail(id,'document_ownership_unverified');return {ok:false,reason:'document_ownership_unverified'};}}
   return null;
  },
  afterResult(id,result){const q=db.prepare('SELECT status FROM uyap_command_queue WHERE id=?').get(id);if(q.status==='completed'){event(db,id,'completed',null,'command:'+id);const g=db.prepare('SELECT * FROM uyap_command_grants WHERE command_id=?').get(id);if(g.kind==='query'){const ids=new Set((result.data?.tumEvraklar||[]).map(d=>String(d.evrakId)));for(const d of db.prepare('SELECT * FROM uyap_remote_documents WHERE case_id=?').all(g.case_id)){if(!ids.has(String(d.remote_document_id)))continue;db.prepare('INSERT OR REPLACE INTO uyap_document_query_proofs VALUES(?,?,?,?,?)').run(d.id,g.case_id,g.binding_hash,documentHash(d),id);}}}else{if(q.status==='queued')fail(id,'retry_requires_user_action');else event(db,id,'failed','query_failed');}},
  resultFailure(id){if(ready(db)&&db.prepare('SELECT 1 FROM uyap_command_grants WHERE command_id=?').get(id))fail(id,'query_processing_failed');},
  automaticRecoveryAllowed:false,
  allowSessionRecovery(source){return source==='successful_network_observation:/get_avukat_id.ajx'&&pending().pending;}
 };
 uyap.setRuntimePolicy(guard);
 function documentHash(d){const m=JSON.parse(d.metadata_json||'{}');return digest([d.case_id,d.remote_document_id,m.dosyaId,m.evrakId]);}
 function downloadProof(caseId,id){const {c,b}=bound(caseId),d=db.prepare('SELECT * FROM uyap_remote_documents WHERE id=? AND case_id=?').get(Number(id),c.id),p=db.prepare('SELECT * FROM uyap_document_query_proofs WHERE remote_id=? AND case_id=?').get(Number(id),c.id);if(!d||!p||p.binding_hash!==b.binding_hash||p.document_hash!==documentHash(d))throw Error('document_binding_verification_required');return d;}
 function begin(caseId,{requestKey,refresh=false}={}){
  if(!ready(db))throw Error('migration_required');if(!UUID.test(requestKey||'')||typeof refresh!=='boolean')throw Error('user_action_key_required');if(uyap.executionHeld())throw Error('local_return_hold');const {c,b}=bound(caseId);
  db.exec('BEGIN IMMEDIATE');try{
   const old=db.prepare('SELECT * FROM uyap_user_actions WHERE request_key=?').get(requestKey);if(old){if(old.case_id!==c.id||old.refresh!==Number(refresh)||old.state==='download_approved')throw Error('idempotency_conflict');db.exec('COMMIT');return {commandId:old.command_id,state:old.state,reused:true};}
   const active=db.prepare("SELECT q.id FROM uyap_command_queue q JOIN uyap_command_grants g ON g.command_id=q.id WHERE g.case_id=? AND g.binding_hash=? AND g.kind='query' AND q.status IN ('queued','running')").get(c.id,b.binding_hash);
   const cached=!refresh?db.prepare("SELECT q.id FROM uyap_command_queue q JOIN uyap_command_grants g ON g.command_id=q.id JOIN uyap_query_events e ON e.command_id=q.id AND e.state='completed' WHERE g.case_id=? AND g.binding_hash=? AND g.kind='query' AND q.status='completed' AND q.finished_at>datetime('now','-15 minutes') ORDER BY q.id DESC LIMIT 1").get(c.id,b.binding_hash):null;
   if(active||cached){const id=(active||cached).id,state=active?'existing_pending':'cache_hit';db.prepare('INSERT INTO uyap_user_actions(request_key,case_id,refresh,command_id,state) VALUES(?,?,?,?,?)').run(requestKey,c.id,Number(refresh),id,state);db.exec('COMMIT');return {commandId:id,state,reused:true};}
   db.prepare("INSERT INTO uyap_user_actions(request_key,case_id,refresh,state) VALUES(?,?,?,'queued')").run(requestKey,c.id,Number(refresh));
   consent={key:requestKey,caseId:c.id,hash:b.binding_hash};
   const id=uyap.enqueueCaseDocumentSync(c.id,{priority:6,purpose:'explicit_user_query',source:'case_query_button'});if(!db.prepare('SELECT 1 FROM uyap_command_grants WHERE command_id=? AND request_key=?').get(id,requestKey))throw Error('unmanaged_active_command');
   db.prepare('UPDATE uyap_user_actions SET command_id=? WHERE request_key=?').run(id,requestKey);db.exec('COMMIT');return {commandId:id,state:'queued',reused:false};
  }catch(e){db.exec('ROLLBACK');throw e;}finally{consent=null;}
 }
 function beginDownloads(caseId,{requestKey,documentIds,confirmed=false}={}){
  if(!ready(db)||uyap.executionHeld())throw Error('migration_or_hold');if(!confirmed||!UUID.test(requestKey||'')||!Array.isArray(documentIds)||!documentIds.length||documentIds.length>200||new Set(documentIds).size!==documentIds.length)throw Error('explicit_document_selection_required');
  const {c,b}=bound(caseId);for(const id of documentIds)downloadProof(c.id,id);
  db.exec('BEGIN IMMEDIATE');try{const old=db.prepare('SELECT * FROM uyap_user_actions WHERE request_key=?').get(requestKey);if(old){if(old.case_id!==c.id||old.state!=='download_approved'||old.scope_hash!==digest([...documentIds].map(Number).sort((a,b)=>a-b)))throw Error('idempotency_conflict');db.exec('COMMIT');return {commandIds:db.prepare('SELECT command_id FROM uyap_command_grants WHERE request_key=?').all(requestKey).map(x=>x.command_id),reused:true};}
   db.prepare("INSERT INTO uyap_user_actions(request_key,case_id,refresh,state,scope_hash) VALUES(?,?,0,'download_approved',?)").run(requestKey,c.id,digest([...documentIds].map(Number).sort((a,b)=>a-b)));consent={key:requestKey,caseId:c.id,hash:b.binding_hash,kind:'download',documents:new Set(documentIds.map(Number))};const ids=[];for(const id of documentIds){const command=uyap.enqueueRemoteDocumentDownload(id);if(command)ids.push(command);}if(ids.length)db.prepare('UPDATE uyap_user_actions SET command_id=? WHERE request_key=?').run(ids[0],requestKey);db.exec('COMMIT');return {commandIds:ids,manualDownloadPaused:uyap.sessionState().manualDownloadPaused};
  }catch(e){db.exec('ROLLBACK');throw e;}finally{consent=null;}
 }
 function downloadOptions(caseId){if(!ready(db))return [];bound(caseId);return db.prepare("SELECT d.id FROM uyap_remote_documents d JOIN uyap_document_query_proofs p ON p.remote_id=d.id WHERE d.case_id=? AND d.status='discovered' AND d.local_asset_id IS NULL LIMIT 200").all(Number(caseId)).filter(d=>{try{downloadProof(caseId,d.id);return true;}catch{return false;}});}
 function history(caseId,options={}){if(!ready(db)&&!db.prepare("SELECT 1 FROM sqlite_master WHERE name='uyap_query_history'").get())return [];return db.prepare(`SELECT h.command_id,h.operation,h.case_id,h.created_at,h.legacy,e.state,e.occurred_at,e.error_code,e.result_ref FROM uyap_query_history h JOIN uyap_query_events e ON e.id=(SELECT max(x.id) FROM uyap_query_events x WHERE x.command_id=h.command_id) WHERE (? IS NULL OR h.case_id=?) AND h.command_id<? ORDER BY h.command_id DESC LIMIT ?`).all(caseId==null?null:Number(caseId),caseId==null?null:Number(caseId),Number(options.beforeId)||Number.MAX_SAFE_INTEGER,Math.max(1,Math.min(200,Number(options.limit)||100)));}
 function status(caseId){if(!ready(db))return {supported:false,reason:'migration_required'};try{bound(caseId);return {supported:true,operation:'document.list',adapter:'court_documents_v1',history:history(caseId)};}catch(e){return {supported:false,reason:e.message,history:history(caseId)};}}
 function pending(){if(!ready(db)||uyap.executionHeld())return {pending:false};const r=db.prepare("SELECT a.request_key FROM uyap_command_grants g JOIN uyap_command_queue q ON q.id=g.command_id JOIN uyap_user_actions a ON a.command_id=q.id WHERE q.status='queued' AND q.attempts=0 AND g.expires_ms>? AND (g.kind='query' OR ?=0) ORDER BY a.rowid DESC LIMIT 1").get(Date.now(),Number(uyap.sessionState().manualDownloadPaused));return {pending:!!r,actionId:r?.request_key};}
 return {begin,beginDownloads,downloadOptions,history,status,pending,downloadPause(paused){if(!ready(db)||uyap.executionHeld())throw Error('migration_or_hold');return uyap.setManualDownloadPause(paused);}};
}
module.exports={install,migrate,rollbackHold,certifyBinding,ready,digest};
