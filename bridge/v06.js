const db=require("./db");
function one(sql,...a){return db.prepare(sql).get(...a)}
function all(sql,...a){return db.prepare(sql).all(...a)}
function audit(action,type,id,detail,actor="system"){db.prepare("INSERT INTO audit_log(occurred_at,actor,action,entity_type,entity_id,detail_json) VALUES(datetime('now'),?,?,?,?,?)").run(actor,action,type,id==null?null:String(id),JSON.stringify(detail||{}))}
function init(){
db.exec(`
CREATE TABLE IF NOT EXISTS postal_shipments(
 id INTEGER PRIMARY KEY,office_file_id INTEGER,case_id INTEGER,remote_document_id INTEGER,asset_id INTEGER,
 recipient TEXT,barcode TEXT,service_type TEXT NOT NULL DEFAULT 'physical',source TEXT NOT NULL DEFAULT 'document',
 status TEXT NOT NULL DEFAULT 'pending',ptt_status TEXT,dispatch_at TEXT,delivered_at TEXT,uyap_receipt_at TEXT,
 legal_service_date TEXT,legal_service_date_approved INTEGER NOT NULL DEFAULT 0,last_checked_at TEXT,next_check_at TEXT,
 error_code TEXT,metadata_json TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(barcode,case_id));
CREATE INDEX IF NOT EXISTS ix_postal_shipments_file ON postal_shipments(office_file_id,status);
CREATE TABLE IF NOT EXISTS postal_events(
 id INTEGER PRIMARY KEY,shipment_id INTEGER NOT NULL,provider TEXT NOT NULL,event_code TEXT,event_text TEXT,
 event_at TEXT,raw_json TEXT,checked_at TEXT NOT NULL DEFAULT(datetime('now')),
 FOREIGN KEY(shipment_id) REFERENCES postal_shipments(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS ix_postal_events_shipment ON postal_events(shipment_id,checked_at);
CREATE TABLE IF NOT EXISTS work_radar_items(
 id INTEGER PRIMARY KEY,office_file_id INTEGER,case_id INTEGER,item_type TEXT NOT NULL,title TEXT NOT NULL,detail TEXT,
 severity TEXT NOT NULL DEFAULT 'info',status TEXT NOT NULL DEFAULT 'open',source_entity_type TEXT,source_entity_id TEXT,
 fingerprint TEXT UNIQUE,detected_at TEXT NOT NULL DEFAULT(datetime('now')),resolved_at TEXT,metadata_json TEXT);
CREATE INDEX IF NOT EXISTS ix_work_radar_open ON work_radar_items(status,severity,detected_at);
CREATE TABLE IF NOT EXISTS document_workflow_events(
 id INTEGER PRIMARY KEY,office_file_id INTEGER,case_id INTEGER,remote_document_id INTEGER,asset_id INTEGER,
 classification TEXT,action TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'done',detail_json TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')));
`);
}
function j(s,d={}){try{return JSON.parse(s||"")}catch{return d}}
function normalizeText(s){return String(s||"").replace(/İ/g,"I").replace(/ı/g,"i").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()}
function extractBarcode(text){
 const t=String(text||"");
 const candidates=t.match(/(?<!\d)\d{13}(?!\d)/g)||[];
 return candidates.find(x=>!/^0+$/.test(x))||null;
}
function classify(title,text=""){
 const s=normalizeText(title+" "+text);
 if(/e[ -]?teblig|tebligat|mazbata/.test(s)) return "tebligat";
 if(/muzekkere.*cevap|cevabi|cevabı/.test(s)) return "muzekkere_cevabi";
 if(/muzekkere/.test(s)) return "muzekkere";
 if(/bilirkisi|rapor/.test(s)) return "rapor";
 if(/iddianame/.test(s)) return "iddianame";
 if(/karar/.test(s)) return "karar";
 if(/dilekce|beyan/.test(s)) return "dilekce";
 return "evrak";
}
function upsertRadar(b){
 const fp=b.fingerprint;if(!fp)throw new Error("fingerprint gerekli");
 db.prepare(`INSERT INTO work_radar_items(office_file_id,case_id,item_type,title,detail,severity,status,source_entity_type,source_entity_id,fingerprint,metadata_json)
 VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET title=excluded.title,detail=excluded.detail,severity=excluded.severity,
 metadata_json=excluded.metadata_json,status=CASE WHEN work_radar_items.status='resolved' THEN work_radar_items.status ELSE excluded.status END`)
 .run(b.officeFileId||null,b.caseId||null,b.itemType,b.title,b.detail||null,b.severity||"info",b.status||"open",b.sourceEntityType||null,b.sourceEntityId==null?null:String(b.sourceEntityId),fp,JSON.stringify(b.metadata||{}));
 return one("SELECT * FROM work_radar_items WHERE fingerprint=?",fp);
}
function processRemoteDocument(remoteId,{text=""}={}){
 const d=one(`SELECT rd.*,c.office_file_id FROM uyap_remote_documents rd JOIN cases c ON c.id=rd.case_id WHERE rd.id=?`,remoteId);
 if(!d)throw new Error("UYAP evrakı bulunamadı");
 const cls=classify(d.remote_title||d.original_file_name,text), barcode=extractBarcode(text);
 db.prepare("INSERT INTO document_workflow_events(office_file_id,case_id,remote_document_id,classification,action,detail_json) VALUES(?,?,?,?,?,?)")
   .run(d.office_file_id,d.case_id,d.id,cls,"classified",JSON.stringify({barcode}));
 if(cls==="tebligat"){
   db.prepare(`INSERT INTO postal_shipments(office_file_id,case_id,remote_document_id,barcode,service_type,source,status,metadata_json)
     VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(barcode,case_id) DO UPDATE SET remote_document_id=COALESCE(excluded.remote_document_id,remote_document_id),updated_at=datetime('now')`)
     .run(d.office_file_id,d.case_id,d.id,barcode,normalizeText(d.remote_title).includes("e-teblig")?"electronic":"physical","uyap_document",barcode?"pending":"needs_review",JSON.stringify({title:d.remote_title}));
   upsertRadar({officeFileId:d.office_file_id,caseId:d.case_id,itemType:"tebligat",title:barcode?"Yeni tebligat — PTT kontrolü bekliyor":"Tebligat — barkod okunamadı",detail:d.remote_title,severity:barcode?"info":"warning",sourceEntityType:"uyap_remote_document",sourceEntityId:d.id,fingerprint:"tebligat:"+d.id});
 } else if(cls==="muzekkere"){
   upsertRadar({officeFileId:d.office_file_id,caseId:d.case_id,itemType:"correspondence",title:"Yeni müzekkere tespit edildi",detail:d.remote_title,severity:"info",sourceEntityType:"uyap_remote_document",sourceEntityId:d.id,fingerprint:"muzekkere:"+d.id});
 } else if(cls==="muzekkere_cevabi"){
   upsertRadar({officeFileId:d.office_file_id,caseId:d.case_id,itemType:"correspondence_response",title:"Müzekkere cevabı geldi — eşleştirme kontrolü",detail:d.remote_title,severity:"action",sourceEntityType:"uyap_remote_document",sourceEntityId:d.id,fingerprint:"muzekkere-cevap:"+d.id});
 } else {
   upsertRadar({officeFileId:d.office_file_id,caseId:d.case_id,itemType:"new_document",title:"Yeni evrak incelenmedi",detail:d.remote_title||d.original_file_name,severity:"info",sourceEntityType:"uyap_remote_document",sourceEntityId:d.id,fingerprint:"new-doc:"+d.id});
 }
 audit("process_new_document","uyap_remote_document",d.id,{classification:cls,barcode});
 return {remoteId:d.id,classification:cls,barcode};
}
function shipments({officeFileId=null,status=null}={}){
 let w=[],a=[];if(officeFileId){w.push("p.office_file_id=?");a.push(officeFileId)}if(status){w.push("p.status=?");a.push(status)}
 return all(`SELECT p.*,o.file_no,c.court,c.court_file_no FROM postal_shipments p LEFT JOIN office_files o ON o.id=p.office_file_id LEFT JOIN cases c ON c.id=p.case_id ${w.length?"WHERE "+w.join(" AND "):""} ORDER BY COALESCE(p.last_checked_at,p.created_at) DESC`,...a);
}
function recordPttResult(id,b){
 const p=one("SELECT * FROM postal_shipments WHERE id=?",id);if(!p)throw new Error("Tebligat bulunamadı");
 const eventText=String(b.eventText||b.status||"").trim(), n=normalizeText(eventText);
 let status="in_transit";if(/teslim|teblig edildi/.test(n))status="delivered";else if(/iade/.test(n))status="returned";else if(/bekliyor|kabul|dagitim|sevk/.test(n))status="in_transit";else if(b.error)status="provider_error";
 db.prepare("INSERT INTO postal_events(shipment_id,provider,event_code,event_text,event_at,raw_json) VALUES(?,?,?,?,?,?)").run(id,b.provider||"ptt",b.eventCode||null,eventText,b.eventAt||null,JSON.stringify(b.raw||b));
 db.prepare(`UPDATE postal_shipments SET ptt_status=?,status=?,delivered_at=CASE WHEN ?='delivered' THEN COALESCE(?,delivered_at) ELSE delivered_at END,
 last_checked_at=datetime('now'),error_code=?,updated_at=datetime('now') WHERE id=?`).run(eventText||null,status,status,b.eventAt||null,b.error||null,id);
 if(status==="delivered")upsertRadar({officeFileId:p.office_file_id,caseId:p.case_id,itemType:"service",title:"PTT teslim gösteriyor — UYAP mazbatasını kontrol et",detail:eventText,severity:"action",sourceEntityType:"postal_shipment",sourceEntityId:id,fingerprint:"ptt-delivered:"+id});
 audit("record_ptt_result","postal_shipment",id,{status,eventText,provider:b.provider||"ptt"});
 return one("SELECT * FROM postal_shipments WHERE id=?",id);
}
function markUyapReceipt(id,b={}){
 const p=one("SELECT * FROM postal_shipments WHERE id=?",id);if(!p)throw new Error("Tebligat bulunamadı");
 const when=b.receiptAt||new Date().toISOString();
 db.prepare("UPDATE postal_shipments SET uyap_receipt_at=?,status='receipt_received',updated_at=datetime('now') WHERE id=?").run(when,id);
 upsertRadar({officeFileId:p.office_file_id,caseId:p.case_id,itemType:"deadline_review",title:"Tebliğ mazbatası geldi — süre kontrolü gerekli",detail:"Tebliğ tarihi otomatik onaylanmadı.",severity:"critical",sourceEntityType:"postal_shipment",sourceEntityId:id,fingerprint:"receipt-deadline-review:"+id});
 audit("mark_uyap_receipt","postal_shipment",id,{receiptAt:when});
 return one("SELECT * FROM postal_shipments WHERE id=?",id);
}
function radar({officeFileId=null,status="open"}={}){
 let w=[],a=[];if(officeFileId){w.push("r.office_file_id=?");a.push(officeFileId)}if(status){w.push("r.status=?");a.push(status)}
 return all(`SELECT r.*,o.file_no,o.title office_file_title,c.court,c.court_file_no FROM work_radar_items r LEFT JOIN office_files o ON o.id=r.office_file_id LEFT JOIN cases c ON c.id=r.case_id ${w.length?"WHERE "+w.join(" AND "):""} ORDER BY CASE r.severity WHEN 'critical' THEN 0 WHEN 'action' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,r.detected_at DESC`,...a);
}
function resolveRadar(id){db.prepare("UPDATE work_radar_items SET status='resolved',resolved_at=datetime('now') WHERE id=?").run(id);audit("resolve_work_radar","work_radar_item",id,{},"lawyer");return one("SELECT * FROM work_radar_items WHERE id=?",id)}
function providerStatus(){return {ptt:{mode:"adapter_ready",automatic:false,legalEffect:false,note:"PTT sonucu operasyonel veridir; hukuki tebliğ tarihi otomatik onaylanmaz."},uyap:{observeOnly:true}}}
init();
module.exports={init,extractBarcode,classify,upsertRadar,processRemoteDocument,shipments,recordPttResult,markUyapReceipt,radar,resolveRadar,providerStatus};
