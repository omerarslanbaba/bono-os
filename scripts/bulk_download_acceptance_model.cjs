'use strict';
// Pure acceptance model; no UYAP, filesystem, DB or network calls.
const {createHash}=require('node:crypto');
const hash=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const key=(r)=>{
 if(!r||!r.caseId||!r.sourceCaseId||!r.documentId)throw new Error('missing verified source identity');
 return [String(r.caseId),String(r.sourceCaseId),String(r.documentId)].map(encodeURIComponent).join('/');
};
function plan(records,previous=new Map(),authorized=false){
 if(!authorized)throw new Error('explicit bulk download authorization required');
 if(!Array.isArray(records))throw new TypeError('document list required');
 const seen=new Set(),queue=[],skipped=[];
 for(const record of records){
  const id=key(record);
  if(seen.has(id)){skipped.push({id,reason:'duplicate-in-list'});continue;}
  seen.add(id);
  const existing=previous.get(id);
  if(existing?.state==='verified'&&existing.bytes&&existing.sha256===hash(existing.bytes)){
   skipped.push({id,reason:'already-verified'});continue;
  }
  // A partial, missing or corrupt local asset never counts as completed.
  queue.push({id,record});
 }
 return {queue,skipped};
}
function executeSimulated(planResult,reader,previous=new Map()){
 const next=new Map(previous),events=[];
 for(const {id,record} of planResult.queue){
  try{
   const bytes=reader(record);
   if(!Buffer.isBuffer(bytes)||!bytes.length)throw new Error('empty-or-invalid-bytes');
   const sha256=hash(bytes);
   if(record.expectedSha256&&record.expectedSha256!==sha256)throw new Error('checksum-mismatch');
   next.set(id,{state:'verified',bytes,sha256,sourceCaseId:record.sourceCaseId,caseId:record.caseId});
   events.push({id,state:'verified'});
  }catch(error){
   next.set(id,{state:'failed',error:error.message});
   events.push({id,state:'failed',error:error.message});
  }
 }
 return {next,events};
}
module.exports={hash,key,plan,executeSimulated};
