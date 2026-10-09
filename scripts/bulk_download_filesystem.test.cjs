'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const safety=require('../bridge/archive_safety');
const {plan,executeSimulated,key,hash}=require('./bulk_download_acceptance_model.cjs');
const fixture=(fn)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'bono-archive-accept-'));try{return fn(root)}finally{fs.rmSync(root,{recursive:true,force:true})}};
const rec=(documentId,caseId='A',sourceCaseId='source-A')=>({documentId,caseId,sourceCaseId});
const write=(p,b)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);return p};
test('production copyVerifiedIntoCase writes and verifies physical SHA-256',()=>fixture(root=>{
 const source=write(path.join(root,'stage','a.udf'),Buffer.from('synthetic archive bytes'));
 const dest=path.join(root,'archive','case-A','a.udf');
 const r=safety.copyVerifiedIntoCase(source,dest,{caseArchiveDir:path.dirname(dest),expectedSha256:safety.sha256File(source)});
 assert.equal(r.action,'copied_verified');assert.equal(r.hashMatch,true);assert.equal(r.sizeMatch,true);
 assert.equal(fs.existsSync(source),true);assert.equal(safety.sameSha(source,dest),true);
 assert.equal(fs.readdirSync(path.dirname(dest)).filter(x=>x.includes('.tmp')).length,0);
}));
test('second filing is verified idempotent and preserves original',()=>fixture(root=>{
 const src=write(path.join(root,'s','a'),Buffer.from('bytes')),dir=path.join(root,'case'),dest=path.join(dir,'a');
 safety.copyVerifiedIntoCase(src,dest,{caseArchiveDir:dir});
 assert.equal(safety.copyVerifiedIntoCase(src,dest,{caseArchiveDir:dir}).action,'already_verified');
 assert.equal(fs.readdirSync(dir).length,1);
}));
test('corrupt canonical target fails closed instead of overwriting',()=>fixture(root=>{
 const src=write(path.join(root,'s','a'),Buffer.from('good')),dir=path.join(root,'case'),dest=write(path.join(dir,'a'),Buffer.from('bad'));
 assert.throws(()=>safety.copyVerifiedIntoCase(src,dest,{caseArchiveDir:dir}),/different content/);
 assert.equal(fs.readFileSync(dest,'utf8'),'bad');
}));
test('truncated staging copy fails expected checksum before filing',()=>fixture(root=>{
 const full=hash(Buffer.from('expected full document')),src=write(path.join(root,'s','part'),Buffer.from('partial'));
 const dest=path.join(root,'case','doc');
 assert.throws(()=>safety.copyVerifiedIntoCase(src,dest,{caseArchiveDir:path.dirname(dest),expectedSha256:full}),/SHA-256 mismatch/);
 assert.equal(fs.existsSync(dest),false);
}));
test('restart simulation reconciles physical corrupted and valid files',()=>fixture(root=>{
 const docs=[rec('a'),rec('b')],dir=path.join(root,'case');
 const valid=write(path.join(dir,'a'),Buffer.from('alpha')),bad=write(path.join(dir,'b'),Buffer.from('truncated'));
 const previous=new Map([[key(docs[0]),{state:'verified',bytes:fs.readFileSync(valid),sha256:safety.sha256File(valid)}],[key(docs[1]),{state:'partial',bytes:fs.readFileSync(bad)}]]);
 assert.deepEqual(plan(docs,previous,true).queue.map(x=>x.record.documentId),['b']);
 const staging=write(path.join(root,'stage','b'),Buffer.from('beta'));
 safety.copyVerifiedIntoCase(staging,path.join(dir,'b-new'),{caseArchiveDir:dir});
 assert.equal(safety.sha256File(path.join(dir,'b-new')),hash(Buffer.from('beta')));
}));
test('same hash, different legal sources retain separate provenance mappings',()=>fixture(root=>{
 const docs=[rec('a','case-A','source-A'),rec('b','case-B','source-B')];
 const blob=write(path.join(root,'blob','canonical'),Buffer.from('same-content'));
 const refs=new Map();
 for(const r of docs){const dir=path.join(root,r.caseId),dest=path.join(dir,'doc');safety.copyVerifiedIntoCase(blob,dest,{caseArchiveDir:dir});refs.set(key(r),{sourceCaseId:r.sourceCaseId,sha256:safety.sha256File(dest),path:dest})}
 assert.equal(refs.size,2);assert.equal(new Set([...refs.values()].map(x=>x.sha256)).size,1);
 assert.notEqual(refs.get(key(docs[0])).sourceCaseId,refs.get(key(docs[1])).sourceCaseId);
}));
test('filing rejects traversal outside target case directory',()=>fixture(root=>{
 const src=write(path.join(root,'stage','a'),Buffer.from('x')),dir=path.join(root,'case');
 assert.throws(()=>safety.copyVerifiedIntoCase(src,path.join(root,'other','doc'),{caseArchiveDir:dir}),/outside expected case/);
}));
test('paused or unapproved batch has no physical writes (isolated adapter)',()=>fixture(root=>{
 const doc=rec('a'),target=path.join(root,'case','doc');
 const run=(authorized,paused)=>{
  if(paused)return {state:'paused',written:false};
  const p=plan([doc],new Map(),authorized);
  const source=write(path.join(root,'stage','doc'),Buffer.from('x'));
  safety.copyVerifiedIntoCase(source,target,{caseArchiveDir:path.dirname(target)});
  return {state:'done',written:p.queue.length>0};
 };
 assert.deepEqual(run(true,true),{state:'paused',written:false});
 assert.equal(fs.existsSync(target),false);
 assert.throws(()=>run(false,false),/authorization/);
 assert.equal(fs.existsSync(target),false);
}));

