(function(root){
 'use strict';
 function install(config){
  const paths=new Set(['/list_dosya_evraklar.ajx','/listDosyaEvraklarPageTotal.ajx']);
  const catalog=root.BONO_OBSERVATION_CONTRACTS;
  let active=null,anchor=null,action=null;
  const send=(type,data)=>root.postMessage({channel:'BONO_UYAP_PAGE',type,data},'*');
  function stop(){const old=active;active=null;action=null;anchor=null;if(old)send('observation_stopped',{sessionId:old.id,documentId:config.documentId});}
  function snapshot(url,body,method){
   if(!active)return null;
   if(Date.now()>active.expires){stop();return null;}
   let parsed;try{parsed=new URL(url,location.href);}catch{return null;}
   if(parsed.origin!==location.origin||!paths.has(parsed.pathname))return null;
   if(!action){stop();return null;}
   let bodyObject={};try{bodyObject=typeof body==='string'?JSON.parse(body):body instanceof URLSearchParams?Object.fromEntries(body):{};}catch{try{bodyObject=Object.fromEntries(new URLSearchParams(body));}catch{}}
   return {sessionId:active.id,documentId:config.documentId,eventId:crypto.randomUUID(),observedAt:new Date().toISOString(),url:parsed.origin+parsed.pathname,method:String(method||'GET').toUpperCase(),action:{...action},request:{body:{dosyaId:bodyObject.dosyaId,pageNumber:bodyObject.pageNumber},query:{dosyaId:parsed.searchParams.get('dosyaId')||undefined}}};
  }
  function emit(snapshot,status,data,reason){
   if(!snapshot||active?.id!==snapshot.sessionId)return;
   const evidence=data?catalog.responseEvidence(data):{};
   send('network_observation',{...snapshot,status,responseEvidence:evidence,capture:{complete:!reason&&evidence.structure?.complete===true,reason:reason||null}});
  }
  async function json(response){
   if(!/json/i.test(response.headers.get('content-type')||''))return {reason:'non_json'};
   if(Number(response.headers.get('content-length'))>250000)return {reason:'byte_limit'};
   try{
    const copy=response.clone();let text='';
    if(copy.body?.getReader){
     const reader=copy.body.getReader(),decoder=new TextDecoder();let bytes=0;
     for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>250000){await reader.cancel();return {reason:'byte_limit'};}text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();
    }else{text=await copy.text();if(text.length>250000)return {reason:'byte_limit'};}
    try{return {data:JSON.parse(text)};}catch{return {reason:'invalid_json'};}
   }catch{return {reason:'read_failed'};}
  }
  const originalFetch=root.fetch.bind(root);
  root.fetch=async function(input,init={}){
   const url=typeof input==='string'?input:input?.url;
   const mark=snapshot(url,init.body,init.method||input?.method);
   try{const response=await originalFetch(input,init);if(mark){const result=await json(response);emit(mark,response.status,result.data,result.reason);}return response;}
   catch(e){emit(mark,0,null,'transport_error');throw e;}
  };
  const xhr=root.XMLHttpRequest.prototype,open=xhr.open,sendOriginal=xhr.send;
  xhr.open=function(method,url,...rest){this.__bonoControlledUrl=url;this.__bonoControlledMethod=method;return open.call(this,method,url,...rest);};
  xhr.send=function(body){
   const mark=snapshot(this.__bonoControlledUrl,body,this.__bonoControlledMethod);
   if(mark)this.addEventListener('loadend',()=>{
    let data,reason=null;
    try{
     if(!/json/i.test(this.getResponseHeader('content-type')||''))reason='non_json';
     else if(this.responseType==='json')data=this.response;
     else if(this.responseText.length>250000)reason='byte_limit';
     else data=JSON.parse(this.responseText);
    }catch{reason='invalid_json';}
    emit(mark,Number(this.status)||0,data,reason);
   },{once:true});
   return sendOriginal.call(this,body);
  };
  root.addEventListener('message',event=>{
   if(event.source!==root||event.data?.channel!=='BONO_UYAP_CONTENT')return;
   if(event.data.type==='observation_disarm'){stop();return;}
   if(event.data.type==='observation_arm'){
    const s=event.data.session;
    if(s.documentId!==config.documentId||s.buildId!==config.buildId)return;
    active={...s};action=null;anchor=null;
   }
  });
  root.addEventListener('click',event=>{
   if(!active||!event.isTrusted)return;
   if(action){stop();return;}
   for(const element of event.composedPath()){
    if(typeof element?.textContent!=='string')continue;
    const label=catalog.groupLabel(element.textContent.trim());
    if(label.caseNo===active.caseNo&&label.type==='cbs_investigation'){
     anchor=element;action={kind:'observed_target_group_click',caseNo:label.caseNo,at:Date.now()};return;
    }
   }
   stop();
  },true);
  root.addEventListener('keydown',event=>{if(active&&event.isTrusted)stop();},true);
  for(const type of ['pagehide','popstate','hashchange'])root.addEventListener(type,stop);
  const observer=new MutationObserver(()=>{if(active&&anchor&&(!anchor.isConnected||catalog.groupLabel(anchor.textContent.trim()).caseNo!==active.caseNo))stop();});
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  send('probe_ready',{probeVersion:2,buildId:config.buildId,documentId:config.documentId});
 }
 root.BONO_CONTROLLED_PROBE={install};
})(window);
