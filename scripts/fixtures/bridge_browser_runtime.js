'use strict';
// Runs the real extension sources; only Chrome APIs, DOM loading and UYAP responses are synthetic.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
module.exports=function browserRuntime({base,payload,failFirstDelivery=false}){
 const source=f=>fs.readFileSync(path.join(__dirname,'../../extension',f),'utf8');
 const callbacks={},intervals=[],messages=[],portalRequests=[],stored={};let backgroundListener,contentListener,deliveryCalls=0;
 const sender={tab:{id:7,active:false,url:'https://avukat.uyap.gov.tr/dosya-sorgulama'},frameId:0};
 const hooks=()=>({addListener(){}}),config={mode:'normal',buildId:'fixture-build'};
 const localFetch=async(url,options)=>{
  if(!String(url).startsWith('http://127.0.0.1:47831/'))throw Error('nonlocal_background_fetch');
  if(String(url).endsWith('/result')){deliveryCalls++;if(failFirstDelivery&&deliveryCalls===1){restartWorker();throw Error('synthetic_local_connection_loss');}}
  return fetch(String(url).replace('http://127.0.0.1:47831',base),options);
 };
 const chrome={runtime:{id:'fixture',getURL:f=>f,onMessage:{addListener:f=>backgroundListener=f},onInstalled:hooks(),onStartup:hooks()},storage:{session:{get:async k=>({[k]:stored[k]}),set:async o=>Object.assign(stored,o),remove:async k=>delete stored[k]}},alarms:{create(){},onAlarm:hooks()},tabs:{onActivated:hooks(),onUpdated:hooks(),onRemoved:hooks(),get:async id=>({...sender.tab,id}),sendMessage:async(id,m)=>new Promise(resolve=>{contentListener(m,{},resolve);resolve({ok:true});})}};
 const restartWorker=()=>vm.runInNewContext(source('background.js'),{importScripts(){},BONO_RUNTIME_CONFIG:config,chrome,URL,Date,Number,String,Map,Set,setTimeout,fetch:localFetch});
 restartWorker();
 const emit=(type,event)=>{for(const cb of callbacks[type]||[])cb(event);};
 const win={addEventListener:(t,f)=>(callbacks[t]??=[]).push(f),postMessage:m=>{messages.push(m);emit('message',{source:win,data:m});},XMLHttpRequest:function(){}};
 win.XMLHttpRequest.prototype={open(){},send(){},setRequestHeader(){}};
 const response=data=>({ok:true,status:200,headers:{get:k=>k==='content-type'?'application/json':null},clone:()=>({json:async()=>data})});
 win.fetch=async(url,init)=>{
  const u=new URL(url);portalRequests.push({path:u.pathname,body:init?.body});
  if(u.pathname==='/get_avukat_id.ajx')return response({ok:true});
  if(u.pathname!=='/list_dosya_evraklar.ajx'&&u.pathname!=='/avukat_dosya_sorgula_cbs_brd.ajx')throw Error('unexpected_portal_path');
  return response(payload);
 };
 let pageContext;
 const doc={currentScript:null,createElement:()=>({dataset:{},remove(){}}),documentElement:{appendChild:s=>{
  doc.currentScript=s;
  if(s.src==='observation_contracts.js')win.BONO_OBSERVATION_CONTRACTS=require('../../extension/observation_contracts');
  else if(s.src==='page_probe.js')vm.runInContext(source(s.src),pageContext);
  s.onload?.();
 }}};
 pageContext=vm.createContext({window:win,document:doc,location:{hostname:'avukat.uyap.gov.tr',origin:'https://avukat.uyap.gov.tr',href:sender.tab.url,pathname:'/dosya-sorgulama'},URL,URLSearchParams,crypto,performance,setTimeout,Date,console});
 const contentChrome={runtime:{id:'fixture',getURL:f=>f,onMessage:{addListener:f=>contentListener=f},sendMessage:m=>new Promise(resolve=>backgroundListener(m,sender,resolve))}};
 const timers=(f,ms)=>ms===350?(f(),1):ms<2000?setTimeout(f,0):1;
 vm.runInNewContext(source('content.js'),{window:win,document:doc,location:{hostname:'avukat.uyap.gov.tr'},chrome:contentChrome,BONO_RUNTIME_CONFIG:config,crypto,Date,setTimeout:timers,clearTimeout(){},setInterval:f=>(intervals.push(f),intervals.length),Map,console});
 return {portalRequests,messages,restartWorker,stored,tick:()=>intervals.forEach(f=>f()),deliveryCalls:()=>deliveryCalls,injectResult:data=>emit('message',{source:win,data:{channel:'BONO_UYAP_PAGE',type:'command_result',data}}),sendResult:data=>new Promise(resolve=>backgroundListener({type:'BONO_RESULT',data},sender,resolve)),foreignResult:data=>new Promise(resolve=>backgroundListener({type:'BONO_RESULT',data},{...sender,tab:{...sender.tab,id:8}},resolve))};
};
