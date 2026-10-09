'use strict';
const assert=require('node:assert/strict');
const {parseCbsDocumentList:parse}=require('../bridge/uyap_case_document_contract');
const {selectGroupsForReview}=require('../bridge/uyap_cbs_document_parser');
const {assertImportAllowed}=require('../extension/observation_contracts');
const tests=[];
function test(name,fn){fn();tests.push(name);console.log('PASS '+name)}
// Entirely synthetic. Quotes and whitespace are intentionally part of opaque IDs.
const ID=' "SYNTHETIC-SOURCE-A" ',DOC='"SYNTHETIC-DOC-A"';
const ctx=()=>({httpStatus:200,captureComplete:true,
  caseIdentity:{verified:true,identity:{uyapDosyaId:ID,court:'Synthetic Unit A',fileNo:'2041/81'}},
  panel:{verified:true,evidenceRef:'synthetic-panel-proof',panelId:'panel-a',dosyaId:ID,tabId:11,frameId:0,documentId:'page-a'},
  request:{method:'POST',path:'/list_dosya_evraklar.ajx',eventId:'event-a',panelId:'panel-a',dosyaId:ID,tabId:11,frameId:0,documentId:'page-a'},
  response:{eventId:'event-a',panelId:'panel-a',dosyaId:ID,tabId:11,frameId:0,documentId:'page-a'}});
const doc=(extra={})=>({dosyaId:ID,evrakId:DOC,tur:'SYNTHETIC-TYPE',...extra});
const response=(groups={'2041/81(CBS Soruşturma Dosyası)':[doc()]},extra={})=>({status:200,pageTotal:1,tumEvraklar:groups,son20Evrak:[],...extra});
const run=(data=response(),c=ctx())=>parse(data,c);

test('single CBS preserves exact quoted identities',()=>{
 const r=run();assert.equal(r.state,'parsed');assert.equal(r.occurrences[0].source.uyapDosyaId,ID);
 assert.equal(r.occurrences[0].source.evrakId,DOC);assert.equal(r.occurrences[0].relationshipState,'verified');
 assert.equal(r.counts.mainOccurrences,1);assert.equal(r.counts.physicalFiles,null);
});
test('main and former CBS keep separate sources and unknown legal link',()=>{
 const r=run(response({'2041/81(CBS Soruşturma Dosyası)':[doc()],'2038/12(CBS Soruşturma Dosyası)':[doc({dosyaId:'OLD'})]}));
 assert.equal(r.groups.length,2);assert.equal(r.occurrences[1].relationshipState,'unknown');assert.equal(r.logicalDocuments.length,2);
});
test('multiple instruction groups are dynamic',()=>{
 const r=run(response({'2040/1(Talimat Dosyası)':[doc({dosyaId:'INSTRUCTION-A'})],'2042/2(Talimat Dosyası)':[doc({dosyaId:'INSTRUCTION-B'})]}));
 assert(r.groups.every(g=>g.display.type==='instruction'&&g.relationshipState==='unknown'));
});
test('mixed sources within one group never inherit group identity',()=>{
 const r=run(response({unknown:[doc(),doc({dosyaId:'OTHER'})]}));
 assert.deepEqual(r.groups[0].sourceIds,[ID,'OTHER']);assert.equal(r.occurrences[1].sourceMatchesTarget,false);
});
test('multiple attachments retain reported parent separately from nesting',()=>{
 const r=run(response({unknown:[doc({ekEvrakListesi:[{evrakId:'E1',anaEvrakId:123,sira:1,ekTuru:'A'},{evrakId:'E2',anaEvrakId:'parent-reference'}]})]}));
 assert.equal(r.counts.attachmentOccurrences,2);const a=r.occurrences[1];assert.equal(a.reportedParentId,123);
 assert.equal(a.parentReference,r.occurrences[0].reference);assert.equal(a.source.uyapDosyaId,null);assert.equal(a.relationshipState,'unknown');
 assert.equal(a.parentIdentityEquality,'unknown');
});
test('repeated attachment occurrences are preserved without physical dedup',()=>{
 const ekEvrakListesi=[{evrakId:'REPEATED',anaEvrakId:'different-format'}];
 const r=run(response({unknown:[doc({ekEvrakListesi}),doc({evrakId:'SECOND',ekEvrakListesi})]}));
 assert.equal(r.counts.attachmentOccurrences,2);assert.equal(r.logicalDocuments.length,2);assert.equal(r.counts.physicalFiles,null);
 assert.equal(r.occurrences[1].logicalKey,null);
});
test('recent view links exact source and document without inflating main counts',()=>{
 const r=run(response(undefined,{son20Evrak:[doc()]}));assert.equal(r.counts.mainOccurrences,1);
 assert.equal(r.counts.recentMainOccurrences,1);assert.equal(r.logicalDocuments.length,1);
 assert.equal(r.logicalDocuments[0].occurrenceReferences.length,2);
});
test('missing identities and unknown labels remain reviewable and unverified',()=>{
 const r=run(response({'Synthetic person name in group':[{},doc({dosyaId:null}),doc({evrakId:null})]}));
 assert.equal(r.occurrences.length,3);assert(r.occurrences.every(o=>!o.logicalKey));
 assert.equal(r.groups[0].display.fileNo,null);assert(!JSON.stringify(r).includes('Synthetic person name'));
});
test('empty successful response differs from never requested',()=>{
 assert.equal(run(response({})).state,'empty');assert.equal(parse(undefined).state,'not_requested');
 assert.equal(run(response({})).requestState,'succeeded');assert.equal(run(response({})).metadataImportAllowed,false);
});
test('HTTP 200 application authorization error cannot expose documents',()=>{
 const r=run(response(undefined,{errorCode:'PRTL_GNL_1-1',message:'PRIVATE-ERROR'}));
 assert.equal(r.state,'failed');assert.equal(r.issues[0].code,'authorization_denied');assert.equal(r.occurrences.length,0);
 assert(!JSON.stringify(r).includes('PRIVATE-ERROR'));
});
test('invalid JSON yields safe diagnostic without raw response',()=>{
 const r=run('{"secret":"PRIVATE-SECRET"');assert.equal(r.parseState,'failed');assert(!JSON.stringify(r).includes('PRIVATE-SECRET'));
});
test('partially malformed groups and attachment arrays are explicit',()=>{
 const r=run(response({valid:[doc({ekEvrakListesi:{bad:1}})],broken:{secret:'SECRET'}}));
 assert.equal(r.parseState,'partial');assert.equal(r.completeness.structure,false);assert(r.importBlockers.includes('partial_response'));
});
test('wrong panel and changed opaque ID fail binding',()=>{
 for(const mutate of [c=>c.panel.panelId='other',c=>c.request.dosyaId='OLD',c=>c.panel.dosyaId=ID.trim()]){
  const c=ctx();mutate(c);assert.equal(run(response(),c).binding.verified,false);
 }
});
test('different synthetic units years and group counts need no special cases',()=>{
 const c=ctx();c.caseIdentity.identity.court='Synthetic Unit Z';c.caseIdentity.identity.fileNo='1997/5';
 const r=run(response({'1997/5(CBS Soruşturma Dosyası)':[doc()],'2071/890(Talimat Dosyası)':[]}),c);
 assert.equal(r.groups.length,2);assert.equal(r.binding.verified,true);
 assert.equal(r.groups[0].display.fileNo,'1997/5');
});
test('parsed readable metadata does not grant production import',()=>{
 const r=run();assert.equal(r.binding.verified,true);assert.equal(r.metadataImportAllowed,false);assert.equal(r.downloadAllowed,false);
 assert.throws(()=>assertImportAllowed({court:'Synthetic Cumhuriyet Başsavcılığı',case_type:'CBS'}),/cbs_document_ownership_unverified/);
});
test('different tab frame page and concurrent event cannot cross correlate',()=>{
 for(const key of ['tabId','frameId','documentId','eventId','panelId','dosyaId']){
  const c=ctx();c.response[key]=typeof c.response[key]==='number'?999:'other';
  assert.equal(run(response(),c).binding.verified,false,key);
 }
});
test('stale page identity and absent causal evidence fail closed',()=>{
 const c=ctx();c.panel.documentId='OLD-PAGE';assert.equal(run(response(),c).binding.verified,false);
 delete c.panel;assert.equal(run(response(),c).binding.reason,'causal_panel_evidence_required');
});
test('capture completeness and pagination are independent of parse success',()=>{
 const c=ctx();c.captureComplete=false;const r=run(response(undefined,{pageTotal:5}),c);
 assert.equal(r.parseState,'parsed');assert.equal(r.completeness.capture,false);assert.equal(r.completeness.list,'unknown');
 assert.equal(r.completeness.pageTotal,5);assert(r.importBlockers.includes('capture_completeness_unverified'));
});
test('all permitted observed fields retain values but private descriptions are omitted',()=>{
 const d=doc({ggEvrakId:'"GG"',birimEvrakNo:'B1',onaylandigiTarih:'2041-01-01',sistemeGonderildigiTarih:'2041-01-02',
 gonderenDosyaNo:'2040/1',gonderenSayi:'GS1',tip:'T1',isYetkili:false,gonderenYerKisi:'PRIVATE-PERSON',aciklama:'PRIVATE-DESCRIPTION',
 cookie:'SECRET',Authorization:'SECRET',token:'SECRET',content:'SECRET'});
 const r=run(response({unknown:[d]})),m=r.occurrences[0].metadata;
 assert.equal(m.ggEvrakId,'"GG"');assert.equal(m.isYetkili,false);assert.equal(m.sistemeGonderildigiTarih,'2041-01-02');
 assert.equal(r.occurrences[0].permission,'reported_denied');assert(r.importBlockers.includes('document_permission_denied'));
 assert(!/PRIVATE-|SECRET/.test(JSON.stringify(r)));assert.deepEqual(r.occurrences[0].omittedPrivateFields,['gonderenYerKisi','aciklama']);
});
test('user selection changes review state without upgrading ownership',()=>{
 const r=run(response({unknown:[doc({dosyaId:'OTHER'})]}));const s=selectGroupsForReview(r,[r.groups[0].reference]);
 assert.equal(s.groups[0].relationshipState,'user_selected_unverified');assert.equal(s.occurrences[0].relationshipState,'unknown');
 assert.equal(r.groups[0].relationshipState,'unknown');assert.equal(s.metadataImportAllowed,false);
 assert.throws(()=>selectGroupsForReview(r,['missing']));
});
test('same document ID on different sources stays distinct',()=>{
 const r=run(response({a:[doc()],b:[doc({dosyaId:'OTHER'})],c:[doc()]}));
 assert.equal(r.logicalDocuments.length,2);assert.equal(r.logicalDocuments[0].occurrenceReferences.length,2);
});
test('identity keys are collision safe and no quotes are stripped',()=>{
 const r=run(response({a:[doc({dosyaId:'a::b',evrakId:'c'}),doc({dosyaId:'a',evrakId:'b::c'}),doc({evrakId:DOC.replaceAll('"','') }),doc()]}));
 assert.equal(r.logicalDocuments.length,4);
});
test('unknown recent shape is not silently counted as a complete list',()=>{
 assert.equal(run(response(undefined,{son20Evrak:{unexpected:[]}})).parseState,'partial');
});
test('HTTP failure or missing application success never means empty success',()=>{
 const c=ctx();c.httpStatus=403;assert.equal(run(response(),c).state,'failed');
 assert.equal(run(response(undefined,{status:undefined})).state,'failed');
 assert.equal(run(response(undefined,{success:false})).state,'failed');
});
test('malformed secret objects in known fields are not retained',()=>{
 const r=run(response({x:[doc({ggEvrakId:{token:'SECRET'},ekEvrakListesi:[{evrakId:'E',anaEvrakId:{token:'SECRET'}}]})]}));
 assert(!JSON.stringify(r).includes('SECRET'));assert.equal(r.parseState,'partial');
});
console.log(JSON.stringify({passed:tests.length,synthetic:true,liveEvidence:false}));
