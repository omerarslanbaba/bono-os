'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {reviewSources,selectForReview,auditIdentityHistory}=require('../bridge/uyap_cbs_document_evidence');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
const event=()=>({sessionId:'fixture-session',eventId:'fixture-event',caseBinding:'request_id_matches_user_confirmed_case',capture:{complete:true},status:200,requestReference:hash('main'),identityGraph:{complete:true,nodes:[
 {node:0,parent:null,edge:{field:'root'},ids:{}},
 {node:1,parent:0,edge:{group:{caseNo:'2026/51832',type:'cbs_investigation'}},ids:{dosyaId:hash('main')}},
 {node:2,parent:1,edge:{field:'unknown'},ids:{}},
 {node:3,parent:2,edge:{index:0},ids:{dosyaId:hash('main'),evrakId:hash('document')}},
 {node:4,parent:0,edge:{group:{caseNo:'2026/51962',type:'cbs_investigation'}},ids:{dosyaId:hash('other')}},
 {node:5,parent:4,edge:{index:0},ids:{evrakId:hash('missing-source')}},
 {node:6,parent:0,edge:{group:{caseNo:'2026/11706',type:'instruction'}},ids:{}},
 {node:7,parent:0,edge:{group:{caseNo:'2026/9621',type:'instruction'}},ids:{}}
 ]}});
test('four source-labelled groups remain distinct',()=>{const r=reviewSources(event());assert.equal(r.groups.length,4);assert.equal(r.groups[0].documentCount,1);assert.equal(r.groups[1].missingSourceCount,1);assert.equal(r.groups[2].sourceReference,null);});
test('nesting does not supply a missing document source',()=>{const r=reviewSources(event());assert.equal(r.documents[1].sourceReference,null);assert.equal(r.documents[1].ownership,'unverified');});
test('matching source references do not prove legal semantics or download',()=>{const r=reviewSources(event());assert.equal(r.documents[0].sourceEqualsRequest,true);assert.equal(r.documents[0].sourceEqualsGroup,true);assert.equal(r.downloadAllowed,false);assert.equal(r.metadataImportAllowed,false);});
test('choosing every group cannot authorize import',()=>{const r=reviewSources(event()),s=selectForReview(r,r.groups.map(g=>g.reference));assert.equal(s.selectedGroups.length,4);assert.equal(s.metadataImportAllowed,false);assert.equal(s.downloadAllowed,false);assert.ok(r.groups.every(g=>!g.defaultSelected));});
test('stale selection cannot select same node in another capture',()=>{const e=event(),old=reviewSources(e).groups[0].reference;e.eventId='another-event';assert.throws(()=>selectForReview(reviewSources(e),[old]));});
test('identity mismatch is blocked',()=>{const e=event();e.caseBinding='dosya_id_mismatch';assert.equal(reviewSources(e).state,'blocked');});
test('incomplete capture and graph remain blocked',()=>{for(const field of ['capture','identityGraph']){const e=event();e[field].complete=false;assert.equal(reviewSources(e).state,'blocked');}});
test('HTTP 200 application error is blocked',()=>{const e=event();e.applicationError={code:'PRTL_GNL_1-1'};assert.equal(reviewSources(e).state,'blocked');});
test('foreign parent or duplicate node invalidates graph',()=>{for(const change of [e=>e.identityGraph.nodes[2].parent=800,e=>e.identityGraph.nodes[2].node=1]){const e=event();change(e);assert.equal(reviewSources(e).reason,'invalid_identity_graph');}});
test('labels and arbitrary personal values do not survive review',()=>{const e=event();e.identityGraph.nodes[1].edge.group.label='PERSON secret';e.identityGraph.nodes[3].ids.token='SECRET';const r=JSON.stringify(reviewSources(e));assert.ok(!r.includes('PERSON')&&!r.includes('SECRET'));});
test('duplicate leaf references counted separately from unique documents',()=>{const e=event();e.identityGraph.nodes[5].ids.evrakId=hash('document');const r=reviewSources(e);assert.equal(r.documentIdentityCount,2);assert.equal(r.uniqueDocumentIdentityCount,1);});
test('identity history is read-only and never aliases rotating opaque IDs',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE cases(id,uyap_dosya_id,uyap_birim_id,court_file_no);CREATE TABLE uyap_query_history(command_id,case_id,operation);CREATE TABLE uyap_command_queue(id,result_json,finished_at,status);CREATE TABLE uyap_remote_documents(case_id);');
 db.prepare('INSERT INTO cases VALUES(?,?,?,?)').run(1,'new','unit','2026/51832');
 for(const [id,opaque] of [[10,'old'],[11,'new']]){db.prepare('INSERT INTO uyap_query_history VALUES(?,?,?)').run(id,1,'cbs.search');db.prepare('INSERT INTO uyap_command_queue VALUES(?,?,?,?)').run(id,JSON.stringify([[{dosyaNo:'2026/51832',birimId:'unit',dosyaId:opaque}],1]),'fixture','completed');}
 const before=db.prepare('SELECT total_changes() n').get().n,r=auditIdentityHistory(db,1);assert.equal(r.transitions.length,1);assert.equal(r.evidence[0].matchesCurrent,false);assert.equal(r.evidence[1].matchesCurrent,true);assert.equal(r.automaticAliasAllowed,false);assert.equal(r.opaqueIdLifetime,'unknown');assert.equal(db.prepare('SELECT total_changes() n').get().n,before);assert.ok(!JSON.stringify(r).includes('"old"'));db.close();
});
console.log(JSON.stringify({ok:true,tests:passed,liveRequests:0,metadataWrites:0}));
