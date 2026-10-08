const v=require("../bridge/v09"),db=require("../bridge/db");
const result={
 orders:v.scanInterimOrders({}),
 notices:v.scanNotifications({}),
 matches:v.scanCorrespondenceMatches({}),
 openOrders:v.actionItems({}).length,
 shipments:db.prepare("SELECT COUNT(id) n FROM postal_shipments").get().n,
 radar:db.prepare("SELECT COUNT(id) n FROM work_radar_items WHERE status='open'").get().n
};
console.log(JSON.stringify(result));
