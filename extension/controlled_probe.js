(function(root){
 'use strict';
 function install(config){
  const paths=new Set(['/list_dosya_evraklar.ajx','/listDosyaEvraklarPageTotal.ajx']);
  const catalog=root.BONO_OBSERVATION_CONTRACTS;
  let active=null,anchor=null,action=null,sequence=0,causalAction=null;
  const panels=new WeakMap();
  const normalize=v=>String(v||" ").replace(/\s+/g," ").trim();
  function panelFor(element){
   const prefix=active.caseNo+" "+normalize(active.unitName)+" - ";
   const matches=Array.from(document.querySelectorAll("*")).filter(e=>e.getClientRects().length>0&&normalize(e.textContent).startsWith(prefix)&&!Array.from(e.children).some(c=>normalize(c.textContent).startsWith(prefix)));
   if(matches.length!==1)return null;
   const title=matches[0];let panel=element;while(panel&&!panel.contains(title))panel=panel.parentElement;
   if(!panel||panel===document.body||panel===document.documentElement)return null;
   if(!panels.has(panel))panels.set(panel,crypto.randomUUID());
   return {element:panel,title,reference:panels.get(panel)};
  }
  const send=(type,data)=>root.postMessage({channel:'BONO_UYAP_PAGE',type,data},'*');
  function stop(){const old=active;active=null;action=null;anchor=null;causalAction=null;if(old)send('observation_stopped',{sessionId:old.id,documentId:config.documentId});}
  function snapshot(url,body,method){
   if(!active)return null;
   if(Date.now()>active.expires){stop();return null;}
   let parsed;try{parsed=new URL(url,location.href);}catch{return null;}
   if(parsed.origin!==location.origin||!paths.has(parsed.pathname))return null;
   if(!action){stop();return null;}
   const provenance=causalAction===action&&action.originEvent?.eventPhase!==0?"synchronous_target_panel_action":"unknown";
   let bodyObject={};try{bodyObject=typeof body==='string'?JSON.parse(body):body instanceof URLSearchParams?Object.fromEntries(body):{};}catch{try{bodyObject=Object.fromEntries(new URLSearchParams(body));}catch{}}
   return {sessionId:active.id,documentId:config.documentId,eventId:crypto.randomUUID(),observedAt:new Date().toISOString(),url:parsed.origin+parsed.pathname,method:String(method||'GET').toUpperCase(),action:{kind:action.kind,caseNo:action.caseNo,at:action.at,id:action.id,panelReference:action.panelReference},sequence:++sequence,panelContext:{reference:action.panelReference,caseNo:active.caseNo,unitName:active.unitName},initiator:provenance,request:{body:{dosyaId:bodyObject.dosyaId,pageNumber:bodyObject.pageNumber},query:{dosyaId:parsed.searchParams.get('dosyaId')||undefined}}};
  }
  function emit(snapshot,status,data,reason){
   if(!snapshot||active?.id!==snapshot.sessionId)return;
   if(snapshot.action.kind==='observed_target_row_open'){
    const tabs=Array.from(document.querySelectorAll('[role="tab"]')).filter(e=>e.getClientRects().length>0&&normalize(e.textContent)==='Evrak');
    const panel=tabs.length===1?panelFor(tabs[0]):null;
    if(!panel){stop();return;}
    if(action.panelElement&&action.panelElement!==panel.element){stop();return;}
    action.panelElement=panel.element;action.titleElement=panel.title;
    snapshot.action.panelReference=panel.reference;snapshot.panelContext.reference=panel.reference;
   }
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
    active={...s};action=null;anchor=null;sequence=0;causalAction=null;
   }
  });
  root.addEventListener('click',event=>{
   if(!active||!event.isTrusted)return;
   if(action){stop();return;}
   for(const element of event.composedPath()){
    if(typeof element?.textContent!=='string')continue;
    if(element.getAttribute?.('id')==='dosya-goruntule'){
     const row=element.closest?.('[role="row"],tr');
     const cells=row?Array.from(row.querySelectorAll('[role="gridcell"],td')).map(c=>normalize(c.textContent)):[];
     if(cells[0]!==normalize(active.unitName)||cells[1]!==active.caseNo){stop();return;}
     anchor=element;action={kind:'observed_target_row_open',caseNo:active.caseNo,at:Date.now(),id:crypto.randomUUID(),panelReference:crypto.randomUUID(),originEvent:event,rowElement:row};
     causalAction=action;return;
    }
    const label=catalog.groupLabel(element.textContent.trim());
    const documentTab=element.getAttribute?.('role')==='tab'&&normalize(element.textContent)==='Evrak';
    if(documentTab||(label.caseNo===active.caseNo&&label.type==='cbs_investigation')){
     const panel=panelFor(element);if(!panel){stop();return;}
     anchor=element;action={kind:documentTab?'observed_target_documents_tab':'observed_target_group_click',caseNo:active.caseNo,at:Date.now(),id:crypto.randomUUID(),panelReference:panel.reference};
     action.originEvent=event;action.panelElement=panel.element;action.titleElement=panel.title;
     causalAction=action;return;
    }
   }
   stop();
  },true);
  root.addEventListener('keydown',event=>{if(active&&event.isTrusted)stop();},true);
  for(const type of ['pagehide','popstate','hashchange'])root.addEventListener(type,stop);
  const observer=new MutationObserver(()=>{
   if(!active||!anchor)return;
   if(!anchor.isConnected){stop();return;}
   if(action.kind==='observed_target_row_open'){
    const cells=Array.from(action.rowElement.querySelectorAll('[role="gridcell"],td')).map(c=>normalize(c.textContent));
    if(!action.rowElement.isConnected||cells[0]!==normalize(active.unitName)||cells[1]!==active.caseNo){stop();return;}
    if(!action.panelElement)return;
   }
   if(!action.panelElement.isConnected||!action.titleElement.isConnected||!normalize(action.titleElement.textContent).startsWith(active.caseNo+' '+normalize(active.unitName)+' - ')||(action.kind==='observed_target_group_click'?catalog.groupLabel(anchor.textContent.trim()).caseNo!==active.caseNo:action.kind==='observed_target_documents_tab'&&normalize(anchor.textContent)!=='Evrak'))stop();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  send('probe_ready',{probeVersion:2,causalVersion:1,buildId:config.buildId,documentId:config.documentId});
 }
 root.BONO_CONTROLLED_PROBE={install};
})(window);
