const db=require("./db");const jobs=require("./jobs");
function one(s,...a){return db.prepare(s).get(...a)} function all(s,...a){return db.prepare(s).all(...a)}
function j(s,d={}){try{return JSON.parse(s||"")}catch{return d}}
function init(){db.exec(`
CREATE TABLE IF NOT EXISTS domain_events(id INTEGER PRIMARY KEY,event_key TEXT NOT NULL,event_type TEXT NOT NULL,entity_type TEXT,entity_id TEXT,office_file_id INTEGER,case_id INTEGER,payload_json TEXT,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,error TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),processed_at TEXT,UNIQUE(event_key));
CREATE INDEX IF NOT EXISTS ix_domain_events_pending ON domain_events(status,event_type,created_at);
CREATE TABLE IF NOT EXISTS uyap_delta_watch(id INTEGER PRIMARY KEY,case_id INTEGER UNIQUE NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,interval_minutes INTEGER NOT NULL DEFAULT 30,last_checked_at TEXT,next_check_at TEXT,last_result TEXT,last_error TEXT,updated_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE INDEX IF NOT EXISTS ix_uyap_delta_due ON uyap_delta_watch(enabled,next_check_at);
`);db.prepare(`INSERT OR IGNORE INTO uyap_delta_watch(case_id,next_check_at) SELECT id,datetime('now') FROM cases`).run()}
function emit(eventType,{key=null,entityType=null,entityId=null,officeFileId=null,caseId=null,payload={}}={}){
 const eventKey=key||[eventType,entityType||"",entityId||"",payload.remoteDocumentId||""].join(":");
 db.prepare(`INSERT OR IGNORE INTO domain_events(event_key,event_type,entity_type,entity_id,office_file_id,case_id,payload_json) VALUES(?,?,?,?,?,?,?)`).run(eventKey,eventType,entityType,entityId==null?null:String(entityId),officeFileId,caseId,JSON.stringify(payload));
 const e=one("SELECT * FROM domain_events WHERE event_key=?",eventKey);if(e&&e.status==="pending")jobs.enqueue("dispatch_domain_event",{eventId:e.id},"domain-event:"+e.id,35);return e;
}
function dispatch(eventId){
 const e=one("SELECT * FROM domain_events WHERE id=?",eventId);if(!e)throw new Error("Event bulunamadı");if(e.status==="processed")return {eventId,already:true};
 const p=j(e.payload_json),workflow=require("./workflow_engine"),v06=require("./v06");let actions=[];
 db.prepare("UPDATE domain_events SET status='processing',attempts=attempts+1,error=NULL WHERE id=?").run(eventId);
 try{
  if(e.event_type==="uyap.document.new"){const r=workflow.trigger("new_document",{remoteDocumentId:Number(e.entity_id),text:p.text||""},e.event_key,"event");actions.push({workflowRunId:r.id});}
  else if(e.event_type==="uyap.document.downloaded"){const r=workflow.trigger("new_document",{remoteDocumentId:Number(e.entity_id),text:p.text||""},e.event_key,"event");actions.push({workflowRunId:r.id});}
  else if(e.event_type==="uyap.document.download_waiting"){v06.radar; const rd=one("SELECT rd.*,c.office_file_id FROM uyap_remote_documents rd JOIN cases c ON c.id=rd.case_id WHERE rd.id=?",Number(e.entity_id));if(rd)db.prepare(`INSERT INTO work_radar_items(office_file_id,case_id,item_type,title,detail,severity,status,source_entity_type,source_entity_id,fingerprint,metadata_json) VALUES(?,?,?,?,?,'info','open','uyap_remote_document',?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET detail=excluded.detail`).run(rd.office_file_id,rd.case_id,"uyap_download","Yeni UYAP evrakı — indirme kanalı bekleniyor",rd.remote_title,String(rd.id),"uyap-download-wait:"+rd.id,JSON.stringify({observeOnly:true}));}
  db.prepare("UPDATE domain_events SET status='processed',processed_at=datetime('now') WHERE id=?").run(eventId);return {eventId,eventType:e.event_type,actions};
 }catch(err){db.prepare("UPDATE domain_events SET status='failed',error=? WHERE id=?").run(String(err.stack||err),eventId);throw err}
}
function onManifest(caseId,newRows,{baseline=false}={}){
 if(baseline)return {emitted:0};let n=0;for(const rd of newRows){emit("uyap.document.new",{key:"uyap.document.new:"+rd.id,entityType:"uyap_remote_document",entityId:rd.id,officeFileId:rd.office_file_id,caseId,payload:{remoteDocumentId:rd.id,title:rd.remote_title}});n++}return {emitted:n};
}
function dueCases(limit=50){return all(`SELECT w.*,c.court,c.court_file_no,c.office_file_id,p.sync_mode,p.auto_download_new FROM uyap_delta_watch w JOIN cases c ON c.id=w.case_id LEFT JOIN uyap_sync_profiles p ON p.case_id=c.id WHERE w.enabled=1 AND (w.next_check_at IS NULL OR w.next_check_at<=datetime('now')) ORDER BY COALESCE(w.next_check_at,'') LIMIT ?`,limit)}
function scheduleDeltaChecks(){
 const uyap=require("./uyap"),due=dueCases();let queued=0,waiting=0;
 for(const x of due){db.prepare("UPDATE uyap_delta_watch SET last_checked_at=datetime('now'),next_check_at=datetime('now',?),last_result=?,updated_at=datetime('now') WHERE case_id=?").run("+"+Math.max(5,Number(x.interval_minutes||30))+" minutes","scheduled",x.case_id);
  if(uyap.rateState().integration_mode==="official_api"){try{uyap.enqueue({commandType:"fetch_json",endpointKey:"case_document_manifest",payload:{caseId:x.case_id,mode:x.sync_mode||"delta"},priority:60});queued++}catch(e){db.prepare("UPDATE uyap_delta_watch SET last_error=? WHERE case_id=?").run(String(e.message||e),x.case_id);waiting++}}
  else waiting++;
 }
 return {due:due.length,queued,waiting,mode:uyap.rateState().integration_mode};
}
function status(){return {watchers:all("SELECT COUNT(*) n,SUM(enabled) enabled FROM uyap_delta_watch")[0],events:{pending:one("SELECT COUNT(*) n FROM domain_events WHERE status='pending'").n,failed:one("SELECT COUNT(*) n FROM domain_events WHERE status='failed'").n},due:dueCases(500).length}}
init();module.exports={init,emit,dispatch,onManifest,dueCases,scheduleDeltaChecks,status};