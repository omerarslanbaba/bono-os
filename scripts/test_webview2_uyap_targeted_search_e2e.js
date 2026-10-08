'use strict';
// Real local HTTP server; portal executor is absent. Legacy discovery must stay blocked.
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),assert=require('assert/strict'),{spawn}=require('child_process');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'bono-user-http-'));process.env.BONO_DB_PATH=path.join(root,'fixture.db');process.env.USERPROFILE=root;
const db=require('../bridge/db'),policy=require('../bridge/uyap_user_queries');policy.migrate(db,{expectedQueued:0,backupManifest:{schema:1,verified:true,queueIdDigest:policy.digest([])}});db.close();
const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const child=spawn(process.execPath,['bridge/server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,BONO_PORT:String(port),BONO_DISABLE_WORKER:'1'},stdio:'ignore',windowsHide:true});
const base='http://127.0.0.1:'+port;try{let healthy=false;for(let i=0;i<100;i++){try{healthy=(await fetch(base+'/health')).ok;if(healthy)break;}catch{}await new Promise(r=>setTimeout(r,40));}assert(healthy);
for(const route of ['case-search','cbs/discover','discover','commands','resume','remote-documents/1/download']){const r=await fetch(base+'/api/uyap/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Bono-User-Action':'1'},body:'{}'});assert.equal(r.status,409,route);}
for(const headers of [{},{'X-Bono-User-Action':'1',Origin:'https://hostile.invalid'}]){const r=await fetch(base+'/api/uyap/cases/1/query',{method:'POST',headers,body:'{}'});assert.equal(r.status,403);}
const pause=await fetch(base+'/api/uyap/download-pause',{method:'POST',headers:{'Content-Type':'application/json','X-Bono-User-Action':'1'},body:JSON.stringify({paused:false})});assert.equal(pause.status,409);
assert.equal((await (await fetch(base+'/api/uyap/queue')).json()).length,0);
assert.equal((await (await fetch(base+'/api/uyap/user-query-state')).json()).pending,false);
assert.equal((await fetch(base+'/api/uyap/query-history')).status,200);
console.log(JSON.stringify({ok:true,legacyDiscoveryBlocked:true,sameOriginConsentRequired:true,pauseSeparateConsent:true,noQueuedCommands:true,portalRequests:0}));
}finally{await new Promise(r=>{child.once('exit',r);child.kill();});}})().catch(e=>{console.error(e);process.exitCode=1;});
