const db=require("../bridge/db");const v=require("../bridge/v06");
function ok(x,m){if(!x)throw new Error(m)}
const c=db.prepare("SELECT id,office_file_id FROM cases WHERE office_file_id IS NOT NULL LIMIT 1").get();ok(c,"case yok");
const rid=Number(db.prepare("INSERT INTO uyap_remote_documents(case_id,remote_document_id,remote_title,original_file_name,status,is_baseline,metadata_json) VALUES(?,?,?,?,?,?,?)").run(c.id,"V06-TEST-"+Date.now(),"Kapalı Tebligat Mazbatası","Kapalı Tebligat.pdf","discovered",0,"{}").lastInsertRowid);
try{
 const x=v.processRemoteDocument(rid,{text:"Muhatap TEST PTT Barkod 1234567890123"});ok(x.classification==="tebligat","class");ok(x.barcode==="1234567890123","barcode");
 const s=db.prepare("SELECT * FROM postal_shipments WHERE remote_document_id=?").get(rid);ok(s,"shipment");
 v.recordPttResult(s.id,{eventText:"TESLİM EDİLDİ",eventAt:"2026-10-07T09:30:00",provider:"test"});
 let s2=db.prepare("SELECT * FROM postal_shipments WHERE id=?").get(s.id);ok(s2.status==="delivered","delivered");
 v.markUyapReceipt(s.id,{receiptAt:"2026-10-07T10:00:00"});s2=db.prepare("SELECT * FROM postal_shipments WHERE id=?").get(s.id);ok(s2.status==="receipt_received","receipt");ok(s2.legal_service_date_approved===0,"legal approval");
 const r=v.radar({officeFileId:c.office_file_id});ok(r.some(z=>z.fingerprint==="receipt-deadline-review:"+s.id),"radar");
 console.log(JSON.stringify({ok:true,classification:x.classification,barcode:x.barcode,shipmentStatus:s2.status,legalDateApproved:s2.legal_service_date_approved,radar:true}));
}finally{const s=db.prepare("SELECT id FROM postal_shipments WHERE remote_document_id=?").get(rid);if(s){db.prepare("DELETE FROM work_radar_items WHERE source_entity_type='postal_shipment' AND source_entity_id=?").run(String(s.id));db.prepare("DELETE FROM postal_shipments WHERE id=?").run(s.id)}db.prepare("DELETE FROM work_radar_items WHERE source_entity_type='uyap_remote_document' AND source_entity_id=?").run(String(rid));db.prepare("DELETE FROM document_workflow_events WHERE remote_document_id=?").run(rid);db.prepare("DELETE FROM uyap_remote_documents WHERE id=?").run(rid)}
