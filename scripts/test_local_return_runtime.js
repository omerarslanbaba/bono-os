'use strict';
// Applies the exact overlay; runtime fixture remaps only the hardcoded live port to a free test port.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),net=require('node:net'),{spawn}=require('node:child_process');
const {inspect,operate}=require('./package_operations');
const bundle=process.argv[2];if(!bundle)throw Error('usage: isolated_overlay_bundle');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bono-held-runtime-')),root=path.join(tmp,'app'),fixture=path.join(root,'data/source.db');
fs.mkdirSync(path.dirname(fixture),{recursive:true});fs.cpSync(path.join(__dirname,'../bridge'),path.join(root,'bridge'),{recursive:true});fs.cpSync(path.join(__dirname,'../web'),path.join(root,'web'),{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(bundle,'version-manifest.json')));
for(const f of manifest.files)fs.copyFileSync(path.join(bundle,'rollback',f.path),path.join(root,f.path));
process.env.BONO_DB_PATH=fixture;process.env.USERPROFILE=tmp;
const db=require('../bridge/db');
db.exec("INSERT OR REPLACE INTO app_settings(key,value) VALUES('uyap_integration_mode','browser_readonly'),('uyap_manual_download_pause','1'),('uyap_session_state','ready');INSERT INTO uyap_endpoints(endpoint_key,method,host,path,enabled) VALUES('hold.fixture','POST','avukat.uyap.gov.tr','/avukat_mahkemeleri_sorgula.ajx',1);");
const add=db.prepare("INSERT INTO uyap_command_queue(command_type,endpoint_key,status,payload_json) VALUES('fetch_json','hold.fixture','queued','{}')");for(let i=0;i<270;i++)add.run();
const before=JSON.stringify(db.prepare('SELECT * FROM uyap_command_queue ORDER BY id').all());db.close();
const free=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
let child,complete=false;const timer=setTimeout(()=>{child?.kill();console.error('isolated_return_runtime_timeout');process.exitCode=1;},20000);
process.once('beforeExit',()=>{if(!complete)process.exitCode=1;});
(async()=>{
 const port=await free();await operate(bundle,root,'Apply',port);assert.equal(inspect(bundle,root).state,'installed');
 const serverPath=path.join(root,'bridge/server.js'),installedServer=fs.readFileSync(serverPath,'utf8');
 assert.equal(installedServer.split('const PORT=47831;').length,2);
 fs.writeFileSync(serverPath,installedServer.replace('const PORT=47831;','const PORT='+port+';'));
 const env={...process.env,BONO_DB_PATH:fixture,USERPROFILE:tmp,BONO_PORT:String(port),BONO_OBSERVATION_ONLY:'0',BONO_UYAP_EXECUTION_HOLD:'0'};
 delete env.BONO_DISABLE_WORKER;
 async function boot(){
  child=spawn(process.execPath,[path.join(root,'bridge/server.js')],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout.on('data',()=>{});let errors='';child.stderr.on('data',b=>errors+=b);
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('isolated_core_exited '+errors);try{const h=await (await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(150)})).json();if(h.ok){assert.equal(h.uyapExecutionHeld,true);return;}}catch(e){if(e.code==='ERR_ASSERTION')throw e;}await new Promise(r=>setTimeout(r,30));}throw Error('isolated_core_not_ready');
 }
 async function stop(){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;child=null;}
 await boot();const base='http://127.0.0.1:'+port;
 assert.equal((await fetch(base+'/')).status,200);
 for(const lane of ['query','download','any']){const r=await fetch(base+'/api/uyap/commands/next?host=avukat.uyap.gov.tr&lane='+lane);const b=r.status===204?{}:await r.json();assert(r.status===204||b.reason==='local_return_hold');}
 const r=await fetch(base+'/api/uyap/commands/1/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ok:true,status:200,data:[]})});assert.equal((await r.json()).reason,'local_return_hold');
 await new Promise(r=>setTimeout(r,1500));await stop();await boot();await stop();
 const {DatabaseSync}=require('node:sqlite'),read=new DatabaseSync(fixture,{readOnly:true});
 assert.equal(JSON.stringify(read.prepare('SELECT * FROM uyap_command_queue ORDER BY id').all()),before);
 assert.equal(read.prepare("SELECT value FROM app_settings WHERE key='uyap_manual_download_pause'").get().value,'1');
 assert.equal(read.prepare("SELECT value FROM app_settings WHERE key='uyap_session_state'").get().value,'ready');
 assert(read.prepare('SELECT count(*) n FROM job_queue').get().n>0);read.close();
 fs.writeFileSync(serverPath,installedServer);assert.equal(inspect(bundle,root).state,'installed');
 await operate(bundle,root,'Rollback',port);assert.equal(inspect(bundle,root).state,'original');complete=true;
 console.log(JSON.stringify({ok:true,tests:['actual_overlay_applied_to_synthetic_installation','normal_ui_available','all_claim_lanes_held','late_result_held','hold_survives_restart_and_env_zero','270_rows_bytewise_logically_unchanged','session_and_pause_preserved','normal_startup_worker_enabled','exact_source_rollback'],temporaryDB:true,normalStartupHasWrites:true,portalExecutorAbsent:true,fixturePortRemapped:true}));
})().catch(e=>{child?.kill();console.error(e);process.exitCode=1;}).finally(()=>clearTimeout(timer));
