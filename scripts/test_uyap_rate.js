'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
// Isolation is mandatory before importing production modules. Never uses the installed DB.
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bono-rate-'));process.env.BONO_DB_PATH=path.join(tmp,'source.db');
const uyap=require('../bridge/uyap'),db=require('../bridge/db');
const setting=(key,value)=>db.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)').run(key,String(value));
(async()=>{
 setting('uyap_integration_mode','browser_readonly');setting('uyap_session_state','ready');setting('uyap_manual_download_pause','1');
 uyap.resume();
 assert.throws(()=>uyap.approveEndpoint({endpointKey:'forbidden.test',method:'GET',host:'avukat.uyap.gov.tr',path:'/__bono_local_test__'}),/izin listesinde/);
 uyap.approveEndpoint({endpointKey:'rate.fixture',method:'POST',host:'avukat.uyap.gov.tr',path:'/avukat_mahkemeleri_sorgula.ajx',purpose:'isolated scheduler fixture',minIntervalMs:2200});
 const a=uyap.enqueue({commandType:'fetch_json',endpointKey:'rate.fixture',payload:{}}),b=uyap.enqueue({commandType:'fetch_json',endpointKey:'rate.fixture',payload:{}});
 const first=uyap.claimNext('avukat.uyap.gov.tr');assert.equal(first.id,a);assert(first.hardMinIntervalMs>=2200);
 const next=uyap.claimNext('avukat.uyap.gov.tr');assert.equal(next.wait,true);assert(next.retryAfterMs>0);assert.equal(db.prepare('SELECT status FROM uyap_command_queue WHERE id=?').get(b).status,'queued');
 uyap.reportResult(a,{ok:true,status:200,contentType:'application/json',data:{}});
 const deadline=uyap.rateState().next_allowed_ms;await new Promise(r=>setTimeout(r,Math.max(0,deadline-Date.now())+30));
 const second=uyap.claimNext('avukat.uyap.gov.tr');assert.equal(second.id,b);assert(Date.now()>=deadline);
 uyap.reportResult(b,{ok:false,status:429,error:'synthetic rate limit'});const state=uyap.rateState();assert.equal(state.state,'rate_limited');assert(state.circuit_open_until_ms>Date.now());
 const c=uyap.enqueue({commandType:'fetch_json',endpointKey:'rate.fixture',payload:{}});const blocked=uyap.claimNext('avukat.uyap.gov.tr');assert(blocked.wait);assert.equal(blocked.reason,'rate_limited');assert.equal(db.prepare('SELECT status FROM uyap_command_queue WHERE id=?').get(c).status,'queued');
 assert.equal(uyap.sessionState().manualDownloadPaused,true);
 console.log(JSON.stringify({ok:true,tests:['disallowed_endpoint_rejected','real_scheduler_spacing','not_dispatched_early','query_with_download_pause','429_circuit_blocks_next'],networkRequests:0,temporaryDB:true}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());
