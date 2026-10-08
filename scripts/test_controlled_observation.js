'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {spawn}=require('node:child_process');
const catalog=require('../extension/observation_contracts'),{ObservationController}=require('../bridge/observation_controller');
const build='a'.repeat(64),extensionId='a'.repeat(32),results=[];
function pass(name){results.push({name,status:'PASS'});}
function harness(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE uyap_observation_events(event_id TEXT PRIMARY KEY,captured_at TEXT,event_json TEXT)');
 let time=Date.now();const controller=new ObservationController({db,buildId:build,now:()=>time,caseReader:()=>({court_file_no:'2020/1',uyap_birim_id:'123',uyap_dosya_id:'synthetic-reference-0001'})});
 const start=()=>controller.start({caseId:1,tabId:1,frameId:0,documentId:'doc-one',contextConfirmed:true,buildId:build,probeVersion:2});
 const event=s=>({sessionId:s.id,tabId:1,frameId:0,documentId:'doc-one',payload:{data:{eventId:crypto.randomUUID(),observedAt:new Date(time).toISOString(),url:'https://avukat.uyap.gov.tr/list_dosya_evraklar.ajx',status:200,action:{kind:'observed_target_group_click',caseNo:'2020/1',at:time},request:{body:{dosyaId:'synthetic-reference-0001'}},capture:{complete:true},responseEvidence:catalog.responseEvidence({tumEvraklar:{'2020/1(CBS Sorusturma Dosyası)':[{evrakId:'PRIVATE_EVRAK_REFERENCE',name:'PRIVATE_PERSON',content:'PRIVATE_CONTENT'}],'2020/2(Talimat Dosyası)':[]}})}}});
 return {db,controller,start,event,setTime:v=>time=v};
}
function controllerTests(){
 const h=harness();let s=h.start(),e=h.event(s);
 assert.equal(h.controller.accept({...e,tabId:2}).accepted,false);assert.equal(h.controller.accept({...e,frameId:1}).accepted,false);
 assert.equal(h.db.prepare('SELECT count(*) n FROM uyap_observation_events').get().n,0);pass('two_tabs_and_frames_excluded');
 assert(h.controller.accept(e).accepted);const saved=h.db.prepare('SELECT event_json FROM uyap_observation_events').get().event_json;
 for(const secret of ['PRIVATE_PERSON','PRIVATE_CONTENT','PRIVATE_EVRAK_REFERENCE','synthetic-reference'])assert(!saved.includes(secret));
 assert(saved.includes('2020/1'));assert(saved.includes('2020/2'));assert(saved.includes('"ownership":"unknown"'));pass('mixed_groups_remain_separate_without_ownership');
 h.controller.stop();s=h.start();e=h.event(s);e.payload.data.request.body.dosyaId='different-case';assert.equal(h.controller.accept(e).reason,'dosya_id_mismatch');assert.equal(h.controller.status().state,'stopped');pass('different_case_same_tab_stops');
 s=h.start();const old=h.event(s);h.controller.stop();s=h.start();assert.equal(h.controller.accept(old).accepted,false);pass('late_previous_session_response_excluded');
 e=h.event(s);e.payload.data.capture.complete=false;assert.equal(h.controller.accept(e).state,'stopped');pass('incomplete_capture_stops');
 s=h.start();e=h.event(s);e.payload.data.responseEvidence=catalog.responseEvidence({errorCode:'PRTL_GNL_1-1',error:'PRIVATE_RAW_ERROR'});assert.equal(h.controller.accept(e).state,'stopped');pass('http_200_authorization_denial_stops');
 s=h.start();h.setTime(Date.now()+120000);assert.equal(h.controller.status().state,'stopped');pass('session_expiry');
 const secretStructure=catalog.structure({'2020/1(PRIVATE_PERSON)':[{name:'PRIVATE_PERSON',aciklama:'PRIVATE_CONTENT',token:'PRIVATE_TOKEN'}]});
 assert(!JSON.stringify(secretStructure).includes('PRIVATE_'));assert.equal(secretStructure.nodes[1].edge.group.type,'unknown');pass('group_label_and_scalar_privacy');
 const huge=catalog.structure({tumEvraklar:Array.from({length:120},()=>({x:1}))},{maxChildren:10});assert(!huge.complete);assert(huge.skipped>0);pass('structural_truncation_reported');h.db.close();
}
function contentHarness({oldGuard=false}={}){
 const scripts=[],runtimeListeners=[],windowListeners={},sent=[];
 const window={__BONO_CONTENT_BRIDGE__:oldGuard,addEventListener:(name,fn)=>windowListeners[name]=fn,postMessage:m=>sent.push(m)};
 const document={createElement:()=>({dataset:{},remove(){}}),documentElement:{appendChild:s=>scripts.push(s)}};
 const chrome={runtime:{id:extensionId,getURL:f=>'chrome-extension://'+extensionId+'/'+f,onMessage:{addListener:f=>runtimeListeners.push(f)},sendMessage:async()=>({})}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/content.js'),'utf8'),{window,document,chrome,crypto,BONO_RUNTIME_CONFIG:{mode:'observation_only',buildId:build},setInterval:()=>{throw new Error('automatic_poll');},setTimeout:()=>{throw new Error('automatic_timer');}});
 return {scripts,runtimeListeners,windowListeners,sent,window};
}
function loadingTests(){
 let h=contentHarness();assert.equal(h.scripts.length,1);h.scripts[0].onerror();let status;h.runtimeListeners[0]({type:'BONO_OBSERVATION_STATUS'},{},x=>status=x);assert.equal(status.error,'catalog_load_failed');assert.equal(status.ready,false);pass('catalog_failure_no_legacy_fallback');
 h=contentHarness({oldGuard:true});assert.equal(h.runtimeListeners.length,0);pass('old_content_guard_detectable_by_missing_handshake');
 const messages=[];vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/page_probe.js'),'utf8'),{window:{__BONO_UYAP_PROBE__:true,postMessage:m=>messages.push(m)},document:{currentScript:{dataset:{bonoMode:'observation_only'}}}});assert.equal(messages[0].type,'probe_conflict');pass('old_probe_reload_conflict_reported');
 h=contentHarness();h.runtimeListeners[0]({type:'BONO_AUTH_PROBE'},{},()=>{});h.runtimeListeners[0]({type:'BONO_EXECUTE',command:{id:1}},{},()=>{});assert.equal(h.sent.length,0);pass('content_zero_automatic_auth_or_dispatch');
}
async function backgroundTests(){
 const hooks={},fetches=[],tabSends=[];let messageListener;
 const hook=name=>({addListener:fn=>hooks[name]=fn});
 const chrome={runtime:{id:extensionId,getURL:f=>'chrome-extension://'+extensionId+'/'+f,onMessage:{addListener:f=>messageListener=f},onInstalled:hook('installed'),onStartup:hook('startup')},storage:{session:{get:async()=>({}),set:async()=>{throw new Error('storage_mutation');},remove:async()=>{throw new Error('storage_mutation');}}},alarms:{create(){throw new Error('alarm_created');},onAlarm:hook('alarm')},tabs:{onActivated:hook('activated'),onUpdated:hook('updated'),onRemoved:hook('removed'),query:async()=>{throw new Error('automatic_tabs_query');},sendMessage:async(...x)=>tabSends.push(x),get:async()=>{throw new Error('unexpected_tab_get');}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),{importScripts(){},BONO_RUNTIME_CONFIG:{mode:'observation_only',buildId:build},chrome,URL,Date,Number,String,setTimeout:()=>{throw new Error('automatic_timer');},fetch:async url=>{fetches.push(url);return {ok:true,json:async()=>({})};}});
 await hooks.installed();await hooks.startup();await hooks.alarm({name:'bono-uyap-poll'});await hooks.activated({tabId:1});await hooks.updated(1,{status:'complete'},{url:'https://avukat.uyap.gov.tr/'});
 for(const type of ['BONO_POLL','BONO_RESULT','BONO_CAPTURE'])await new Promise(resolve=>messageListener({type},{tab:{id:1},frameId:0},resolve));
 assert.equal(fetches.length,0);assert.equal(tabSends.length,0);pass('background_zero_automatic_network_auth_poll_reload');
 chrome.tabs.get=async()=>({id:1,url:'https://avukat.uyap.gov.tr/'});
 const mixed=await new Promise(resolve=>messageListener({type:'BONO_OBSERVATION_START',tabId:1,frameId:0,caseId:1,contextConfirmed:true},{id:extensionId,url:chrome.runtime.getURL('observation.html')},resolve));
 assert.equal(mixed.error,'core_build_mismatch');assert(fetches.every(url=>url==='http://127.0.0.1:47831/health'));assert.equal(tabSends.length,0);pass('new_observer_rejects_old_or_mismatched_core');
}
async function serverTests(){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bono-controlled-')),sourcePath=path.join(tmp,'source.db'),evidencePath=path.join(tmp,'evidence.db');
 let source=new DatabaseSync(sourcePath);source.exec("CREATE TABLE cases(id INTEGER,court_file_no TEXT,uyap_birim_id TEXT,uyap_dosya_id TEXT); INSERT INTO cases VALUES(1,'2020/1','123','synthetic-reference-0001');CREATE TABLE uyap_command_queue(id INTEGER,status TEXT);INSERT INTO uyap_command_queue VALUES(1,'running');CREATE TABLE job_queue(id INTEGER,status TEXT);INSERT INTO job_queue VALUES(1,'running');CREATE TABLE app_settings(key TEXT,value TEXT);INSERT INTO app_settings VALUES('uyap_manual_download_pause','1');");source.close();
 const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');const before=hash();
 const net=require('node:net');const port=await new Promise(resolve=>{const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const p=socket.address().port;socket.close(()=>resolve(p));});});
 const cp=spawn(process.execPath,[path.join(__dirname,'../bridge/server.js')],{env:{...process.env,BONO_OBSERVATION_ONLY:'1',BONO_DB_PATH:sourcePath,BONO_OBSERVATION_DB_PATH:evidencePath,BONO_OBSERVATION_BUILD_ID:build,BONO_OBSERVATION_EXTENSION_ID:extensionId,BONO_PORT:String(port)},stdio:['pipe','pipe','pipe']});
 let logs='';cp.stdout.on('data',x=>logs+=x);cp.stderr.on('data',x=>logs+=x);
 const base='http://127.0.0.1:'+port,headers={'Content-Type':'application/json','X-Bono-Extension-Id':extensionId};
 const request=(p,body)=>fetch(base+p,{headers,...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
 try{
  let ready=false;for(let i=0;i<80;i++){try{const res=await request('/health');if(res.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,25));}assert(ready,'observer_start_failed');
  assert.equal((await request('/api/uyap/commands/next')).status,204);
  for(const route of ['/api/uyap/downloads/resume','/api/uyap/cases/1/sync-documents','/api/uyap/commands/1/result'])assert.equal((await request(route,{})).status,404);
  assert.equal((await fetch(base+'/observation/start',{method:'POST',headers:{...headers,Origin:'https://avukat.uyap.gov.tr'},body:'{}'})).status,403);
  await request('/events',{payload:{data:{secret:'PRIVATE_RAW'}}});
  const bad=await fetch(base+'/events',{method:'POST',headers,body:'{"PRIVATE_RAW_TOKEN"'});assert.equal(bad.status,400);
  assert.equal(hash(),before);source=new DatabaseSync(sourcePath,{readOnly:true});assert.equal(source.prepare('SELECT status FROM uyap_command_queue').get().status,'running');assert.equal(source.prepare('SELECT status FROM job_queue').get().status,'running');assert.equal(source.prepare('SELECT value FROM app_settings').get().value,'1');source.close();
  assert(!logs.includes('PRIVATE_RAW'));pass('core_boot_zero_queue_pause_jobs_source_db_changes');pass('core_rejects_commands_and_foreign_origin');pass('raw_json_errors_not_logged');
 }finally{cp.stdin.end('stop\n');await new Promise(resolve=>cp.once('exit',resolve));}
}
(async()=>{controllerTests();loadingTests();await backgroundTests();await serverTests();console.log(JSON.stringify({ok:true,results},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
