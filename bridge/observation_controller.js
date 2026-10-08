'use strict';
const crypto=require('node:crypto');
const catalog=require('../extension/observation_contracts');
const paths=new Set(['/list_dosya_evraklar.ajx','/listDosyaEvraklarPageTotal.ajx']);
class ObservationController{
 constructor({db,caseReader,buildId,now=Date.now}){Object.assign(this,{db,caseReader,buildId,now});this.active=null;this.last=null;}
 stop(reason='user_stop'){
  if(this.active){this.last={id:this.active.id,state:'stopped',reason,events:this.active.events};this.active=null;}
  return this.last;
 }
 status(){if(this.active&&this.now()>this.active.expires)this.stop('expired');return this.active?{id:this.active.id,state:'active',events:this.active.events,expires:this.active.expires}:this.last||{state:'idle'};}
 start(input){
  if(this.status().state==='active')throw new Error('session_already_active');
  if(input.buildId!==this.buildId||input.probeVersion!==2||!input.documentId||!input.contextConfirmed)throw new Error('probe_or_context_unverified');
  if(!Number.isInteger(input.tabId)||!Number.isInteger(input.frameId)||input.frameId<0)throw new Error('invalid_target');
  const row=this.caseReader(input.caseId);if(!row?.uyap_dosya_id||!row.uyap_birim_id||!/^20\d{2}\/\d+$/.test(row.court_file_no||''))throw new Error('case_binding_unavailable');
  this.active={id:crypto.randomUUID(),salt:crypto.randomBytes(32),started:this.now(),expires:this.now()+60000,events:0,tabId:input.tabId,frameId:input.frameId,documentId:input.documentId,expectedId:String(row.uyap_dosya_id),caseNo:row.court_file_no,unitId:row.uyap_birim_id};
  return {id:this.active.id,started:this.active.started,expires:this.active.expires,caseNo:this.active.caseNo,documentId:this.active.documentId,buildId:this.buildId};
 }
 accept(input){
  if(this.status().state!=='active')return {accepted:false,reason:'inactive'};
  const s=this.active,d=input.payload?.data||{};
  if(input.sessionId!==s.id||input.tabId!==s.tabId||input.frameId!==s.frameId||input.documentId!==s.documentId)return {accepted:false,reason:'target_or_session_mismatch'};
  let url;try{url=new URL(d.url);}catch{return {accepted:false,reason:'invalid_url'};}
  if(url.origin!=='https://avukat.uyap.gov.tr'||!paths.has(url.pathname))return {accepted:false,reason:'out_of_scope'};
  if(!/^[a-zA-Z0-9-]{8,100}$/.test(d.eventId||'')||Date.parse(d.observedAt)<s.started||!Number.isFinite(Date.parse(d.observedAt)))return {accepted:false,reason:'late_or_invalid_event'};
  if(d.action?.kind!=='observed_target_group_click'||d.action.caseNo!==s.caseNo||!Number.isFinite(d.action.at)||d.action.at<s.started||d.action.at>Date.parse(d.observedAt)){this.stop('action_unverified');return {accepted:false,reason:'action_unverified'};}
  const requestId=d.request?.body?.dosyaId??d.request?.query?.dosyaId;
  if(String(requestId||'')!==s.expectedId){this.stop('dosya_id_mismatch');return {accepted:false,reason:'dosya_id_mismatch'};}
  // Re-sanitize the structure at the trust boundary. No raw field/value object is persisted.
  const raw=d.responseEvidence||{},nodes=[];
  for(const n of (Array.isArray(raw.structure?.nodes)?raw.structure.nodes:[]).slice(0,800)){
   const allowedFields=new Set(['root','tumEvraklar','son20Evrak','pageTotal','status','errorCode','evrakId','dosyaId','tur','tip','onaylandigiTarih','unknown']);
   const safeGroup=catalog.groupLabel(n.edge?.group?.label);
   if(safeGroup.caseNo&&['cbs_investigation','instruction'].includes(n.edge?.group?.type))safeGroup.type=n.edge.group.type;
   const edge=n.edge?.group?{group:safeGroup}:Number.isInteger(n.edge?.index)?{index:n.edge.index}:{field:allowedFields.has(n.edge?.field)?n.edge.field:'unknown'};
   nodes.push({id:Number.isInteger(n.id)?n.id:null,parent:Number.isInteger(n.parent)?n.parent:null,edge,type:['object','array','string','number','boolean','null'].includes(n.type)?n.type:'unknown'});
  }
  const complete=d.capture?.complete===true&&raw.structure?.complete===true&&nodes.length>0&&raw.structure.nodes.length<=800;
  const error=catalog.applicationError({errorCode:raw.applicationError?.code});
  const event={schema:'uyap.controlled-observation.v2',sessionId:s.id,eventId:d.eventId,observedAt:d.observedAt,tabId:s.tabId,frameId:s.frameId,documentId:s.documentId,caseNo:s.caseNo,
   requestReference:crypto.createHmac('sha256',s.salt).update(s.expectedId).digest('hex'),path:url.pathname,method:['GET','POST'].includes(d.method)?d.method:'unknown',status:Number(d.status)||0,
   action:{kind:'observed_target_group_click',caseNo:s.caseNo},caseBinding:'request_id_matches_user_confirmed_case',ownership:'unknown',parameterProvenance:'historical_cbs_list',
   capture:{complete,reason:complete?null:'incomplete_capture',skipped:Number.isSafeInteger(raw.structure?.skipped)?raw.structure.skipped:null,privacyOmitted:Number.isSafeInteger(raw.structure?.privacyOmitted)?raw.structure.privacyOmitted:null},structure:{nodes,semantics:'unknown'},applicationError:error};
  const changes=this.db.prepare('INSERT OR IGNORE INTO uyap_observation_events(event_id,captured_at,event_json) VALUES(?,?,?)').run(event.eventId,new Date(this.now()).toISOString(),JSON.stringify(event)).changes;
  s.events+=Number(changes);
  if(error||[401,403].includes(event.status))this.stop('authorization_or_application_error');else if(!complete)this.stop('incomplete_capture');
  return {accepted:!!changes,complete,state:this.status().state};
 }
}
module.exports={ObservationController};
