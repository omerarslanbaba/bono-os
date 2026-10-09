'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {acceptObservation,safeTelemetry}=require('./cbs_event_acceptance_model.cjs');
const ctx={session:'session-current',tab:'tab-one',frame:'frame-zero',panel:'panel-A',pageDocument:'page-current',requestId:'request-1',secret:'fixture-secret-only',connected:true};
const event=()=>({...Object.fromEntries(['session','tab','frame','panel','pageDocument','requestId'].map(x=>[x,ctx[x]])),method:'POST',path:'/list_dosya_evraklar.ajx',response:{status:200,tumEvraklar:[],son20Evrak:[],pageTotal:1}});
test('matched current event passes with opaque HMAC reference',()=>{const r=acceptObservation(event(),ctx);assert.equal(r.accepted,true);assert.match(r.observationRef,/^[0-9a-f]{64}$/)});
for(const [label,field,value] of [['stale session','session','old'],['other tab','tab','other'],['wrong frame','frame','other'],['wrong panel','panel','other'],['stale page document','pageDocument','other'],['wrong request','requestId','other']]){
 test(label+' fails closed',()=>{const e=event();e[field]=value;assert.equal(acceptObservation(e,ctx).accepted,false)});
}
test('duplicate event ignored',()=>{const seen=new Set();assert.equal(acceptObservation(event(),ctx,seen).accepted,true);assert.equal(acceptObservation(event(),ctx,seen).reason,'duplicate')});
test('disconnected event rejected',()=>{assert.equal(acceptObservation(event(),{...ctx,connected:false}).reason,'disconnected')});
test('partial response rejected',()=>{const e=event();delete e.response.tumEvraklar;assert.equal(acceptObservation(e,ctx).reason,'incomplete-response')});
test('application error rejected despite transport success',()=>{const e=event();e.response.status='error';assert.equal(acceptObservation(e,ctx).accepted,false)});
test('telemetry excludes response and opaque document data',()=>{const e=event();e.response.tumEvraklar=[{syntheticOpaqueDocumentIdentifier:'secret-fixture'}];const telemetry=safeTelemetry(acceptObservation(e,ctx));assert.equal(JSON.stringify(telemetry).includes('secret-fixture'),false);assert.equal(JSON.stringify(telemetry).includes('session-current'),false)});
test('HMAC observation ref is not document identity',()=>{const a=acceptObservation(event(),ctx),b=acceptObservation({...event(),requestId:'request-2'},{...ctx,requestId:'request-2'});assert.notEqual(a.observationRef,b.observationRef);assert.equal(a.observationRef.includes('request'),false)});

