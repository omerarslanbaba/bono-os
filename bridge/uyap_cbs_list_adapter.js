'use strict';
// Pure adapter: no DB, queue, HTTP, party lookup, binding or download side effects.
const PATH='/avukat_dosya_sorgula_cbs_brd.ajx';
const KEYS=['birimId','birimTuru2','birimTuru3','dosyaDurumKod','pageNumber','pageSize'];
const fail=code=>{throw new Error(code);};
function prepareCbsList({observation,unit,status=0,page=1}){
  const b=observation?.request?.body;
  if(observation?.sourceType!=='persisted live observation'||!observation.reference||observation.method!=='POST'||observation.path!==PATH)fail('CBS_OBSERVATION_REQUIRED');
  if(!b||Object.keys(b).sort().join()!==KEYS.join()||b.birimId!==''||b.birimTuru3!=='3'||typeof b.birimTuru2!=='string'||!b.birimTuru2||b.pageSize!==500||b.pageNumber!==1||![0,1].includes(b.dosyaDurumKod)||Object.keys(observation.request.query||{}).length)fail('CBS_TEMPLATE_UNVERIFIED');
  if(!unit?.reference||unit.sourceType!=='completed cbs.units'||typeof unit.birimId!=='string'||!unit.birimId||!Number.isInteger(unit.ilKodu)||unit.ilKodu<1||unit.ilKodu>81)fail('CBS_UNIT_EVIDENCE_REQUIRED');
  if(![0,1].includes(status)||!Number.isSafeInteger(page)||page<1)fail('CBS_SCOPE_INVALID');
  return {method:'POST',path:PATH,query:{},body:{dosyaDurumKod:status,pageSize:500,pageNumber:page,birimId:'',birimTuru2:unit.birimId,birimTuru3:'3'},context:{birimId:unit.birimId,ilKodu:unit.ilKodu,status,page,pageSize:500,observationRef:observation.reference,unitRef:unit.reference},executable:false};
}
function selectCbsTarget({target,pages}){
  if(typeof target?.birimId!=='string'||!target.birimId||!/^\d{4}\/[1-9]\d*$/.test(target.dosyaNo||'')||!Array.isArray(pages)||!pages.length)fail('CBS_TARGET_INVALID');
  const matches=[],seen=new Set();let total=null,count=0,status=null;
  for(let i=0;i<pages.length;i++){
    const {context:c,data,reference}=pages[i]||{};
    if(!reference||c?.birimId!==target.birimId||c.page!==i+1||c.pageSize!==500||![0,1].includes(c.status)||(status!==null&&status!==c.status))fail('CBS_PAGE_SCOPE_MISMATCH');
    status=c.status;
    // HTTP 200 objects, summaries, strings, missing counts and unknown envelopes fail closed.
    if(!Array.isArray(data)||data.length!==2||!Array.isArray(data[0])||!Number.isSafeInteger(data[1])||data[1]<0||data[0].length>500)fail('CBS_RESPONSE_UNVERIFIED');
    if(total!==null&&total!==data[1])fail('CBS_RESULT_CHANGED');total=data[1];
    for(const row of data[0]){
      if(!row||row.birimId==null||String(row.birimId)!==target.birimId||typeof row.dosyaNo!=='string'||!/^\d{4}\/[1-9]\d*$/.test(row.dosyaNo)||typeof row.dosyaId!=='string'||!row.dosyaId.trim()||row.dosyaDurumKod!==status)fail('CBS_ROW_UNVERIFIED');
      if(seen.has(row.dosyaId))fail('CBS_DUPLICATE_ROW');seen.add(row.dosyaId);count++;
      if(row.dosyaNo===target.dosyaNo)matches.push({birimId:target.birimId,dosyaNo:row.dosyaNo,dosyaId:row.dosyaId,sourceReference:reference});
    }
    if(count>total||i<pages.length-1&&data[0].length!==500)fail('CBS_PAGINATION_INCONSISTENT');
  }
  if(count<total){const fullPage=pages[pages.length-1].data[0].length===500;return {state:'incomplete',received:count,total,nextPage:fullPage?pages.length+1:null,reason:fullPage?'more_pages_required':'capture_or_pagination_inconsistent',identity:null,canBindDocuments:false};}
  if(matches.length>1)return {state:'ambiguous',identity:null,canBindDocuments:false};
  const identity=matches[0]||null;
  if(identity&&target.dosyaId&&target.dosyaId!==identity.dosyaId)return {state:'identity_mismatch',identity:null,canBindDocuments:false};
  return {state:identity?'found':'not_found',identity,total,canBindDocuments:false,documentListEvidence:'unknown',executable:false};
}
module.exports={prepareCbsList,selectCbsTarget};
