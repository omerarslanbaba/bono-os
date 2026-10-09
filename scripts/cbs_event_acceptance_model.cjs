'use strict';
const crypto=require('node:crypto');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const opaque=(x)=>typeof x==='string'&&x.length>0;
function acceptObservation(event,context,seen=new Set()){
 if(!event||!context||!opaque(context.session)||!opaque(context.tab)||!opaque(context.frame)||!opaque(context.panel)||!opaque(context.pageDocument)||!opaque(context.requestId))return {accepted:false,reason:'missing-context'};
 if(!context.connected)return {accepted:false,reason:'disconnected'};
 for(const k of ['session','tab','frame','panel','pageDocument','requestId']){
  if(!opaque(event[k])||!equal(event[k],context[k]))return {accepted:false,reason:'context-mismatch'};
 }
 if(event.method!=='POST'||event.path!=='/list_dosya_evraklar.ajx')return {accepted:false,reason:'unexpected-endpoint'};
 if(!event.response||!Object.hasOwn(event.response,'status')||!Object.hasOwn(event.response,'tumEvraklar')||!Object.hasOwn(event.response,'son20Evrak')||!Object.hasOwn(event.response,'pageTotal'))return {accepted:false,reason:'incomplete-response'};
 const ref=crypto.createHmac('sha256',context.secret).update([event.session,event.tab,event.frame,event.panel,event.pageDocument,event.requestId].join('|')).digest('hex');
 if(seen.has(ref))return {accepted:false,reason:'duplicate'};
 if(event.response.status!==200 && event.response.status!=='success')return {accepted:false,reason:'unverified-application-status'};
 seen.add(ref);
 return {accepted:true,observationRef:ref};
}
function safeTelemetry(result){return {accepted:!!result.accepted,reason:result.reason||'accepted',observationRef:result.observationRef||null};}
module.exports={acceptObservation,safeTelemetry};

