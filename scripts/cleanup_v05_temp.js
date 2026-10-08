const db=require("../bridge/db");
const rows=db.prepare("SELECT id FROM cases WHERE external_id LIKE '__v05test_%'").all();
for(const r of rows)db.prepare("DELETE FROM cases WHERE id=?").run(r.id);
console.log(JSON.stringify({removed:rows.length,cases:db.prepare("SELECT COUNT(*) n FROM cases").get().n}));
