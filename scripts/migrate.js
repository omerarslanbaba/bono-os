const db=require("../bridge/db");
const row=db.prepare("SELECT value FROM schema_meta WHERE key=?").get("version");
console.log("SCHEMA",row?.value);
