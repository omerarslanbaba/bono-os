'use strict';
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const catalog=require('../extension/observation_contracts');
const events=[];
class XHR {
 open(){} setRequestHeader(){} getResponseHeader(){return 'application/json';}
 addEventListener(_,fn){this.done=fn;}
 send(){this.status=200;this.responseType='json';this.response={son20Evrak:[{}],pageTotal:1};this.done();}
}
const window={BONO_OBSERVATION_CONTRACTS:catalog,XMLHttpRequest:XHR,postMessage:e=>events.push(e),addEventListener(){},fetch:async()=>({status:200,headers:{get:k=>k==='content-type'?'application/json':null},clone:()=>({json:async()=>({errorCode:'PRTL_GNL_1-1'})})})};
vm.runInNewContext(fs.readFileSync(require.resolve('../extension/page_probe.js'),'utf8'),{window,crypto,URL,URLSearchParams,FormData,Date,performance,location:{href:'https://avukat.uyap.gov.tr/dosya-sorgulama',hostname:'avukat.uyap.gov.tr',pathname:'/dosya-sorgulama'}});
(async()=>{
 await window.fetch('/list_dosya_evraklar.ajx',{method:'POST',body:JSON.stringify({dosyaId:'synthetic',pageNumber:1})});
 await new Promise(resolve=>setImmediate(resolve));
 const xhr=new XHR();xhr.open('POST','/list_dosya_evraklar.ajx');xhr.send('dosyaId=synthetic&pageNumber=1');
 const observed=events.filter(x=>x.type==='network_observation').map(x=>x.data);
 assert.equal(observed.length,2);assert.notEqual(observed[0].eventId,observed[1].eventId);
 assert.equal(observed[0].request.body.dosyaId,'synthetic');
 assert.equal(observed[0].responseEvidence.applicationError.code,'PRTL_GNL_1-1');
 assert.equal(observed[1].responseEvidence.recentCount,1);
 assert(observed.every(x=>Number.isFinite(Date.parse(x.observedAt))));
 console.log('PASS synthetic fetch/XHR request-response event correlation');
})().catch(e=>{console.error(e);process.exitCode=1;});
