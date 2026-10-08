const db=require("../bridge/db");
const rows=db.prepare("SELECT id,job_type,fingerprint,status FROM job_queue WHERE id IN (91,92,93)").all();
const safe=rows.every(x=>x.status==="failed"&&((x.job_type==="dispatch_domain_event"&&/^domain-event:[12]$/.test(x.fingerprint||""))||(x.job_type==="run_workflow"&&x.fingerprint==="workflow-run:11")));
if(!safe) throw new Error("Beklenmeyen job bulundu; temizlik durduruldu.");
const r=db.prepare("DELETE FROM job_queue WHERE id IN (91,92,93)").run();
console.log(JSON.stringify({deleted:Number(r.changes),failedRemaining:db.prepare("SELECT COUNT(*) n FROM job_queue WHERE status='failed'").get().n}));
