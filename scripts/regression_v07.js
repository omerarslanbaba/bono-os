const db=require("../bridge/db"),w=require("../bridge/workflow_engine");
function ok(x,m){if(!x)throw new Error(m)}
const wf=w.definitions();ok(wf.length>=4,"seed");
const run=w.trigger("postal_watch",{test:true},"regression","manual");const done=w.run(run.id);ok(done.status==="completed","run");
const def=db.prepare("INSERT INTO workflow_definitions(key,name,trigger_type,enabled) VALUES(?,?,?,1)").run("approval_test_"+Date.now(),"Approval Test","manual");const wid=Number(def.lastInsertRowid);
const st=db.prepare("INSERT INTO workflow_steps(workflow_id,step_order,step_key,step_type,config_json,requires_approval) VALUES(?,1,'approval','enqueue_job',?,1)").run(wid,JSON.stringify({jobType:"rebuild_search",priority:99}));
const rr=Number(db.prepare("INSERT INTO workflow_runs(workflow_id,trigger_type,input_json,status) VALUES(?,'manual','{}','queued')").run(wid).lastInsertRowid);
try{let x=w.run(rr);ok(x.status==="waiting_approval","gate");const a=db.prepare("SELECT id FROM workflow_approvals WHERE run_id=?").get(rr);ok(a,"approval");w.approve(a.id,false,"regression");x=db.prepare("SELECT * FROM workflow_runs WHERE id=?").get(rr);ok(x.status==="cancelled","reject");console.log(JSON.stringify({ok:true,workflows:wf.map(x=>x.key),postalRun:done.status,approvalGate:true,rejection:x.status}))}
finally{db.prepare("DELETE FROM workflow_definitions WHERE id=?").run(wid);db.prepare("DELETE FROM workflow_runs WHERE id=?").run(run.id);db.prepare("DELETE FROM job_queue WHERE fingerprint=?").run("workflow-run:"+run.id)}
