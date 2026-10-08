const db=require("../bridge/db");
const ids=[35,36,37];
const rows=db.prepare("SELECT id,job_type,fingerprint,status,error FROM job_queue WHERE id IN (35,36,37) ORDER BY id").all();
const ok=rows.length===3&&rows.every(x=>x.status==="failed")&&rows.some(x=>String(x.error||"").includes("Bilinmeyen job: dispatch_domain_event"))&&rows.some(x=>String(x.error||"").includes("Workflow run bulunamadı"));
if(!ok) throw new Error("Eski entegrasyon job doğrulaması başarısız; temizlik yapılmadı.");
const r=db.prepare("DELETE FROM job_queue WHERE id IN (35,36,37)").run();
const remaining=db.prepare("SELECT COUNT(id) n FROM job_queue WHERE status='failed'").get().n;
console.log(JSON.stringify({deleted:Number(r.changes),failedRemaining:remaining}));
