'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
(async()=>{const hooks={},sends=[],fetches=[],stored={};let listener,action={pending:false};const hook=k=>({addListener:f=>hooks[k]=f});
const chrome={runtime:{id:'fixture',getURL:f=>f,onMessage:{addListener:f=>listener=f},onInstalled:hook('install'),onStartup:hook('startup')},storage:{session:{get:async k=>({[k]:stored[k]}),set:async v=>Object.assign(stored,v),remove:async k=>delete stored[k]}},alarms:{create(){},onAlarm:hook('alarm')},tabs:{onActivated:hook('activated'),onUpdated:hook('updated'),onRemoved:hook('removed'),get:async id=>({id,url:'https://avukat.uyap.gov.tr/web1.uyap'}),sendMessage:async(id,m)=>sends.push({id,m}),query:async()=>[]}};
vm.runInNewContext(fs.readFileSync('extension/background.js','utf8'),{importScripts(){},BONO_RUNTIME_CONFIG:{mode:'normal',buildId:'fixture'},chrome,URL,Date,Number,String,setTimeout:f=>f(),fetch:async url=>{fetches.push(url);assert(url.startsWith('http://127.0.0.1:47831/'));return {ok:true,status:204,json:async()=>action};}});
await hooks.install();await hooks.startup();await hooks.activated({tabId:1});await hooks.updated(1,{status:'complete'},{url:'https://avukat.uyap.gov.tr/web1.uyap'});assert.equal(sends.length,0);assert.equal(fetches.length,0);
const poll=(id,active=true,frameId=0)=>new Promise(r=>listener({type:'BONO_POLL',host:'avukat.uyap.gov.tr',lane:'query'},{tab:{id,active},frameId},r));
await Promise.all([poll(1),poll(2)]);assert.equal(sends.length,0);action={pending:true,actionId:'one-explicit-action'};
await Promise.all([poll(1),poll(2),poll(1)]);assert.equal(sends.length,1);assert.equal(sends[0].m.type,'BONO_AUTH_PROBE');
await poll(2,false);await poll(1,true,1);assert.equal(sends.length,1);
// Restarted background has no retained authorization; Core grants still gate all claims.
assert(!fetches.some(u=>u.includes('/commands/next')));
console.log(JSON.stringify({ok:true,noStartupPortalProbeOrReload:true,twoTabsOneAuthPerAction:true,subframesExcluded:true,noClaimWithoutAuth:true,portalRequests:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
