const db=require("./db");

function enqueue(jobType,payload={},fingerprint=null,priority=100){
  if(fingerprint){
    const existing=db.prepare("SELECT id,status FROM job_queue WHERE job_type=? AND fingerprint=? AND status IN ('queued','running','completed') ORDER BY id DESC LIMIT 1").get(jobType,fingerprint);
    if(existing) return existing.id;
  }
  const r=db.prepare(`INSERT INTO job_queue(job_type,fingerprint,payload_json,priority)
    VALUES(?,?,?,?)`).run(jobType,fingerprint,JSON.stringify(payload),priority);
  audit("enqueue_job","job",String(r.lastInsertRowid),{jobType,fingerprint});
  return Number(r.lastInsertRowid);
}
function claim(){
  db.exec("BEGIN IMMEDIATE");
  try{
    const row=db.prepare(`SELECT * FROM job_queue WHERE status='queued' AND attempts < max_attempts
      ORDER BY priority ASC,id ASC LIMIT 1`).get();
    if(!row){db.exec("COMMIT");return null}
    db.prepare(`UPDATE job_queue SET status='running',attempts=attempts+1,started_at=datetime('now'),error=NULL WHERE id=?`).run(row.id);
    db.exec("COMMIT");
    return {...row,attempts:row.attempts+1,payload:row.payload_json?JSON.parse(row.payload_json):{}};
  }catch(e){db.exec("ROLLBACK");throw e}
}
function complete(id,result={}){
  db.prepare(`UPDATE job_queue SET status='completed',finished_at=datetime('now'),result_json=? WHERE id=?`).run(JSON.stringify(result),id);
  audit("complete_job","job",String(id),result);
}
function fail(id,error){
  const row=db.prepare("SELECT attempts,max_attempts FROM job_queue WHERE id=?").get(id);
  const status=row && row.attempts < row.max_attempts ? "queued":"failed";
  db.prepare(`UPDATE job_queue SET status=?,error=?,finished_at=CASE WHEN ?='failed' THEN datetime('now') ELSE NULL END WHERE id=?`).run(status,String(error&&error.stack||error),status,id);
  audit("fail_job","job",String(id),{status,error:String(error&&error.message||error)});
}
function audit(action,type,id,detail){
  db.prepare(`INSERT INTO audit_log(occurred_at,actor,action,entity_type,entity_id,detail_json)
    VALUES(datetime('now'),'system',?,?,?,?)`)
    .run(action,type,id,JSON.stringify(detail||{}));
}
function recoverRunning(){
  const stranded=db.prepare("UPDATE job_queue SET attempts=CASE WHEN max_attempts>0 THEN max_attempts-1 ELSE 0 END,error=COALESCE(error,'recovered after restart') WHERE status='queued' AND attempts>=max_attempts AND error LIKE '%recovered after restart%'").run();
  const r=db.prepare("UPDATE job_queue SET status='queued',attempts=CASE WHEN attempts>0 THEN attempts-1 ELSE 0 END,started_at=NULL,error=COALESCE(error,'recovered after restart') WHERE status='running'").run();
  const count=Number(stranded.changes)+Number(r.changes);
  if(count) audit("recover_jobs","job",null,{count,stranded:Number(stranded.changes),running:Number(r.changes)});
  return count;
}
function list(limit=50){return db.prepare("SELECT * FROM job_queue ORDER BY id DESC LIMIT ?").all(limit)}
module.exports={enqueue,claim,complete,fail,recoverRunning,list,audit};
