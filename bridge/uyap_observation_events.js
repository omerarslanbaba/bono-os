'use strict';
const catalog=require('../extension/observation_contracts');
function cleanEvent(input,source={}){
  if(!/^[a-zA-Z0-9-]{8,100}$/.test(input.eventId||''))return null;
  const url=new URL(input.url);
  if(!/(^|\.)uyap\.gov\.tr$/.test(url.hostname))throw new Error('invalid_observation_host');
  const params={};
  // Existing observed request fields only; cookies, free text and headers never persisted.
  for(const section of ['body','query']){
    params[section]={};
    for(const key of ['dosyaId','pageNumber']){
      const v=input.request?.[section]?.[key];
      if((typeof v==='string'&&v.length<=500)||typeof v==='number')params[section][key]=v;
    }
  }
  const evidence=input.responseEvidence||{};
  const groups=Array.isArray(evidence.groups)?evidence.groups.slice(0,100).map(g=>({label:catalog.groupLabel(g.label).label,shape:['array','object'].includes(g.shape)?g.shape:'unknown',count:Number.isSafeInteger(g.count)?g.count:null})):[];
  const code=input.responseSummary?.applicationError?.code||evidence.applicationError?.code;
  return {schema:'uyap.observation-event.v1',catalogVersion:catalog.version,eventId:input.eventId,
    observedAt:Number.isFinite(Date.parse(input.observedAt))?input.observedAt:null,
    tabId:Number.isSafeInteger(source.tabId)?source.tabId:null,frameId:Number.isSafeInteger(source.frameId)?source.frameId:null,
    screenPath:typeof source.sourceUrl==='string'?new URL(source.sourceUrl).pathname:null,
    method:['GET','POST'].includes(input.method)?input.method:'unknown',path:url.pathname,
    contractId:catalog.contract(url.pathname)?.id||null,status:Number(input.status)||0,request:params,
    response:{pageTotal:Number.isSafeInteger(evidence.pageTotal)?evidence.pageTotal:null,recentCount:Number.isSafeInteger(evidence.recentCount)?evidence.recentCount:null,groups,
      applicationError:code?{code:code==='PRTL_GNL_1-1'?code:'unknown'}:null},
    action:'unknown',caseBinding:'unverified',parameterProvenance:'unknown'};
}
function record(db,input,source){
  const event=cleanEvent(input,source);if(!event)return null;
  db.prepare('INSERT OR IGNORE INTO uyap_observation_events(event_id,captured_at,event_json) VALUES(?,?,?)').run(event.eventId,new Date().toISOString(),JSON.stringify(event));
  return event;
}
module.exports={cleanEvent,record};
