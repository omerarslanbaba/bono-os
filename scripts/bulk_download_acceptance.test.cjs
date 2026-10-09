'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {hash,key,plan,executeSimulated}=require('./bulk_download_acceptance_model');
const record=(documentId,caseId='case-A',sourceCaseId='source-A')=>({documentId,caseId,sourceCaseId});
test('explicit user authorization and verified identity are mandatory',()=>{
 assert.throws(()=>plan([record('a')]),/authorization/);
 assert.throws(()=>plan([{caseId:'case-A',documentId:'a'}],new Map(),true),/source identity/);
});
test('multi-document batch processes all distinct source identities',()=>{
 const docs=['a','b','c'].map(x=>record(x));
 const planned=plan(docs,new Map(),true);
 assert.equal(planned.queue.length,3);
 const outcome=executeSimulated(planned,r=>Buffer.from('synthetic-'+r.documentId));
 assert.equal(outcome.events.filter(x=>x.state==='verified').length,3);
});
test('duplicate rows and second batch do not redownload verified content',()=>{
 const docs=[record('a'),record('a'),record('b')],first=plan(docs,new Map(),true);
 assert.equal(first.queue.length,2);
 assert.equal(first.skipped.length,1);
 const done=executeSimulated(first,r=>Buffer.from(r.documentId));
 const again=plan(docs,done.next,true);
 assert.equal(again.queue.length,0);
});
test('restart resumes only unfinished and corrupted entries',()=>{
 const records=[record('a'),record('b'),record('c')];
 const prior=new Map([[key(records[0]),{state:'verified',bytes:Buffer.from('a'),sha256:hash(Buffer.from('a'))}],[key(records[1]),{state:'partial',bytes:Buffer.from('trunc')}],[key(records[2]),{state:'verified',bytes:Buffer.from('tampered'),sha256:hash(Buffer.from('original'))}]]);
 const planned=plan(records,prior,true);
 assert.deepEqual(planned.queue.map(x=>x.record.documentId),['b','c']);
 assert.equal(plan(records,executeSimulated(planned,r=>Buffer.from(r.documentId),prior).next,true).queue.length,0);
});
test('same content in two source cases retains both provenance records',()=>{
 const a=record('d','case-A','source-A'),b=record('d','case-B','source-B');
 const p=plan([a,b],new Map(),true);
 const done=executeSimulated(p,()=>Buffer.from('same content'));
 assert.equal(done.next.size,2);
 assert.equal(done.next.get(key(a)).sha256,done.next.get(key(b)).sha256);
 assert.notEqual(done.next.get(key(a)).sourceCaseId,done.next.get(key(b)).sourceCaseId);
});
test('partial failure does not mark batch complete or block retry',()=>{
 const docs=[record('a'),record('b'),record('c')];
 const first=executeSimulated(plan(docs,new Map(),true),r=>{if(r.documentId==='b')throw new Error('connection-lost');return Buffer.from(r.documentId)});
 assert.deepEqual(first.events.map(x=>x.state),['verified','failed','verified']);
 const retry=plan(docs,first.next,true);
 assert.deepEqual(retry.queue.map(x=>x.record.documentId),['b']);
 assert.equal(executeSimulated(retry,()=>Buffer.from('b'),first.next).events[0].state,'verified');
});
test('hash mismatch and empty bytes fail closed',()=>{
 const a={...record('a'),expectedSha256:hash(Buffer.from('correct'))};
 const b=record('b');
 const out=executeSimulated(plan([a,b],new Map(),true),r=>r.documentId==='a'?Buffer.from('wrong'):Buffer.alloc(0));
 assert.equal(out.events.filter(x=>x.state==='failed').length,2);
});
test('same document ID in different cases is not cross-case deduplicated',()=>{
 const p=plan([record('same','A','S'),record('same','B','S')],new Map(),true);
 assert.equal(p.queue.length,2);
});
