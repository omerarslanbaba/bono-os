'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),net=require('node:net');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bono-return-'));process.env.BONO_DB_PATH=path.join(tmp,'fixture.db');process.env.USERPROFILE=tmp;
const db=require('../bridge/db'),{hash}=require('./package_operations');
db.exec("INSERT OR REPLACE INTO app_settings(key,value) VALUES('uyap_manual_download_pause','1'),('uyap_session_state','ready'),('uyap_integration_mode','observe_only');INSERT INTO job_queue(job_type,status,attempts,priority) VALUES('synthetic_held','running',1,99999);");
const job=db.prepare("SELECT id FROM job_queue WHERE job_type='synthetic_held'").get().id;db.close();
const fixture=process.env.BONO_DB_PATH,sourceBefore=hash(fixture);let child,complete=false;
process.once('beforeExit',()=>{if(!complete){console.error('TEST_INCOMPLETE');process.exitCode=1;}});
const watchdog=setTimeout(()=>{child?.kill();console.error('TEST_TIMEOUT');process.exit(1);},20000);
const free=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const boot=async observation=>{
 const port=await free();child=spawn(process.execPath,[path.join(__dirname,'../bridge/server.js')],{env:{...process.env,BONO_PORT:String(port),BONO_DISABLE_WORKER:'1',BONO_OBSERVATION_ONLY:observation?'1':'0',BONO_OBSERVATION_DB_PATH:path.join(tmp,'evidence.db'),BONO_OBSERVATION_EXTENSION_ID:'a'.repeat(32),BONO_OBSERVATION_BUILD_ID:'a'.repeat(64)},stdio:['pipe','pipe','pipe']});
 let logs='';child.stderr.on('data',x=>logs+=x);child.stdout.on('data',()=>{});
 for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(200)});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,30));}throw Error('boot_failed '+logs);
};
(async()=>{
 await boot(true);assert.equal(hash(fixture),sourceBefore);const observer=child;const ended=new Promise(r=>observer.once('exit',r));observer.stdin.end('stop\n');assert.equal(await ended,0);
 await boot(false);const {DatabaseSync}=require('node:sqlite'),read=new DatabaseSync(fixture,{readOnly:true});
 assert.equal(read.prepare('SELECT status FROM job_queue WHERE id=?').get(job).status,'queued');assert.equal(read.prepare('SELECT attempts FROM job_queue WHERE id=?').get(job).attempts,0);
 assert(read.prepare("SELECT count(*) n FROM job_queue WHERE job_type IN ('scan_documents','rebuild_search')").get().n>=2);
 assert.equal(read.prepare("SELECT value FROM app_settings WHERE key='uyap_manual_download_pause'").get().value,'1');assert.equal(read.prepare("SELECT value FROM app_settings WHERE key='uyap_session_state'").get().value,'ready');read.close();
 const normal=child;const stopped=new Promise(r=>normal.once('exit',r));normal.kill();await stopped;complete=true;
 console.log(JSON.stringify({ok:true,tests:['observer_source_unchanged','graceful_observer_stop','normal_startup_recovery_preserved','normal_startup_scan_jobs_preserved','session_and_manual_pause_preserved'],workerDisabledInFixture:true,normalStartupHasWrites:true}));
})().catch(e=>{child?.kill();console.error(e);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
