const db=require("../bridge/db");
const v=require("../bridge/v09");
db.exec("BEGIN");
try{
  db.prepare("DELETE FROM work_radar_items WHERE source_entity_type='local_asset' AND fingerprint LIKE 'local-tebligat:%'").run();
  db.prepare("DELETE FROM work_radar_items WHERE source_entity_type='hearing_action_item' AND fingerprint LIKE 'hearing-action:%'").run();
  db.prepare("DELETE FROM postal_shipments WHERE source='local_document'").run();
  db.prepare("DELETE FROM document_extraction_log WHERE extractor='notification-v1'").run();
  db.prepare("DELETE FROM hearing_action_items").run();
  db.exec("COMMIT");
}catch(e){db.exec("ROLLBACK");throw e}
const result={
  orders:v.scanInterimOrders({}),
  notices:v.scanNotifications({}),
  matches:v.scanCorrespondenceMatches({})
};
result.openOrders=v.actionItems({}).length;
result.shipments=db.prepare("SELECT COUNT(*) n FROM postal_shipments").get().n;
result.radar=db.prepare("SELECT COUNT(*) n FROM work_radar_items WHERE status='open'").get().n;
console.log(JSON.stringify(result));
