'use strict';

// Pure, local metadata adapter. Never pass this result to logs/telemetry: IDs are
// exact legal source references. No network, persistence or import permission.
const {applicationError}=require('../extension/observation_contracts');
const VERSION='bono.cbs-document-list.v1';
const PATH='/list_dosya_evraklar.ajx';
const RESPONSE_CONTRACT=Object.freeze({version:VERSION,path:PATH,method:'POST',contentType:'text/json',
  evidence:'user-confirmed-devtools-response-schema',requestParameters:'unchanged_existing_contract',
  executable:false,topLevelFields:['tumEvraklar','son20Evrak','pageTotal','status']});
const MAIN_FIELDS=['evrakId','dosyaId','ggEvrakId','birimEvrakNo',
  'onaylandigiTarih','sistemeGonderildigiTarih','gonderenDosyaNo','gonderenSayi','tur','tip','isYetkili'];
const PRIVATE_FIELDS=['gonderenYerKisi','aciklama'];
const ATTACHMENT_FIELDS=['anaEvrakId','evrakId','sira','ekTuru','dosyaId'];
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const opaque=v=>typeof v==='string'&&v.length>0?v:null; // No trim, decode or alias.
const scalar=v=>v===null||['string','boolean'].includes(typeof v)||(typeof v==='number'&&Number.isFinite(v));
function displayGroup(title){
  const m=title.match(/^(\d{4}\/\d{1,10})(?:\(([^()]*)\))?$/);
  const types={'CBS Soruşturma Dosyası':'cbs_investigation','CBS Sorusturma Dosyası':'cbs_investigation','Talimat Dosyası':'instruction'};
  return {fileNo:m?.[1]||null,type:m?types[m[2]]||'unknown':'unknown'};
}

// Evidence must be supplied by the trusted Core adapter, never by portal JSON.
// Correlation alone is insufficient: PR17 case identity AND causally bound panel
// evidence must match the request/response tuple exactly.
function bindingState(context={}){
  const {caseIdentity:c,panel:p,request:q,response:r}=context;
  if(c?.verified!==true||!opaque(c.identity?.uyapDosyaId)||!c.identity?.court||!c.identity?.fileNo)
    return {verified:false,reason:'verified_case_identity_required'};
  if(p?.verified!==true||!opaque(p.evidenceRef)||!opaque(p.panelId)||!opaque(p.dosyaId))
    return {verified:false,reason:'causal_panel_evidence_required'};
  if(!q||!r||!opaque(q.eventId)||!opaque(q.documentId)||!Number.isInteger(q.tabId)||!Number.isInteger(q.frameId))
    return {verified:false,reason:'request_response_context_missing'};
  if(q.method!=='POST'||q.path!==PATH||q.panelId!==p.panelId||
    q.dosyaId!==p.dosyaId||p.dosyaId!==c.identity.uyapDosyaId)
    return {verified:false,reason:'panel_request_identity_mismatch'};
  if(['eventId','tabId','frameId','documentId','panelId','dosyaId'].some(k=>q[k]!==r[k])||
    ['tabId','frameId','documentId'].some(k=>p[k]!==q[k]))
    return {verified:false,reason:'request_response_context_mismatch'};
  return {verified:true,reason:null};
}

function parseCbsDocumentList(input,context={}){
  const binding=bindingState(context);
  const out={contractVersion:VERSION,linkedCaseContract:'bono.linked-legal-cases.v1',
    state:'not_requested',fileQueryState:'unknown',requestState:'unknown',parseState:'not_started',binding,
    groups:[],occurrences:[],logicalDocuments:[],issues:[],
    counts:{mainOccurrences:0,attachmentOccurrences:0,recentMainOccurrences:0,recentAttachmentOccurrences:0,logicalIdentities:0,physicalFiles:null},
    completeness:{capture:context.captureComplete===true,structure:false,list:'unknown',pageTotal:null,pageTotalMeaning:'unknown'},
    metadataImportAllowed:false,importBlockers:['production_cbs_import_gate_closed'],
    downloadAllowed:false,physicalIntegrity:'not_checked'};
  if(input===undefined)return out;
  let data=input;
  if(typeof input==='string'){
    try{data=JSON.parse(input)}catch{
      out.state='invalid';out.parseState='failed';out.issues.push({code:'invalid_json'});return out;
    }
  }
  if(!object(data)){out.state='invalid';out.parseState='failed';out.issues.push({code:'invalid_envelope'});return out;}
  if(context.httpStatus!==200||data.status!==200||applicationError(data)||data.success===false||data.error){
    out.state='failed';out.requestState='failed';out.parseState='not_started';
    out.issues.push({code:applicationError(data)?.category==='authorization'?'authorization_denied':'http_or_application_status_unverified'});
    return out;
  }
  out.requestState='succeeded';
  out.completeness.pageTotal=Number.isSafeInteger(data.pageTotal)&&data.pageTotal>=0?data.pageTotal:null;
  const logical=new Map();
  const issue=(code,reference)=>out.issues.push({code,...(reference?{reference}:{})});
  function record(item,view,groupReference,parentReference=null){
    const reference='occurrence:'+out.occurrences.length;
    if(!object(item)){issue('invalid_record',reference);return;}
    const kind=parentReference?'attachment':'main',metadata={};
    for(const field of kind==='main'?MAIN_FIELDS:ATTACHMENT_FIELDS){
      if(!Object.hasOwn(item,field))continue;
      if(!scalar(item[field])){issue('invalid_field_type',reference);continue;}
      metadata[field]=item[field];
    }
    const dosyaId=opaque(item.dosyaId),evrakId=opaque(item.evrakId);
    if(!evrakId)issue('document_id_missing_or_invalid',reference);
    // Missing attachment source is not repaired from the enclosing main record.
    if(!dosyaId)issue('source_id_missing_or_invalid',reference);
    const logicalKey=dosyaId&&evrakId?JSON.stringify([dosyaId,evrakId]):null;
    const sourceMatchesTarget=dosyaId&&opaque(context.caseIdentity?.identity?.uyapDosyaId)
      ?dosyaId===context.caseIdentity.identity.uyapDosyaId:null;
    const relationship=binding.verified&&sourceMatchesTarget===true?'verified':'unknown';
    const occurrence={reference,view,groupReference,kind,parentReference,metadata,
      omittedPrivateFields:PRIVATE_FIELDS.filter(f=>Object.hasOwn(item,f)),
      source:{uyapDosyaId:dosyaId,evrakId,ownershipState:relationship},
      visibleFromUyapDosyaId:opaque(context.panel?.dosyaId),sourceMatchesTarget,
      relationshipState:relationship,logicalKey,
      permission:item.isYetkili===false?'reported_denied':'unknown',
      reportedParentId:kind==='attachment'?(item.anaEvrakId??null):null,
      parentIdentityEquality:'unknown',downloadReference:'unknown',metadataImportAllowed:false};
    // Do not retain arbitrary objects from anaEvrakId (or unknown fields).
    if(!scalar(occurrence.reportedParentId))occurrence.reportedParentId=null;
    out.occurrences.push(occurrence);
    const counter=view==='son20Evrak'?(kind==='main'?'recentMainOccurrences':'recentAttachmentOccurrences'):
      kind==='main'?'mainOccurrences':'attachmentOccurrences';
    out.counts[counter]++;
    if(logicalKey){
      if(!logical.has(logicalKey))logical.set(logicalKey,{key:logicalKey,source:{uyapDosyaId:dosyaId,evrakId},occurrenceReferences:[],physicalContent:{sha256:null,integrityVerified:false}});
      logical.get(logicalKey).occurrenceReferences.push(reference);
    }
    if(kind==='main'&&Object.hasOwn(item,'ekEvrakListesi')){
      if(!Array.isArray(item.ekEvrakListesi)){issue('invalid_attachment_list',reference);return;}
      for(const child of item.ekEvrakListesi)record(child,view,groupReference,reference);
    }
  }
  function groups(value,view){
    if(!object(value)){issue('invalid_group_map');return;}
    for(const [title,items] of Object.entries(value)){
      const reference='group:'+out.groups.length;
      // Keep only strict display number/type; free labels may contain names.
      const group={reference,view,display:displayGroup(title),relationshipState:'unknown',sourceIds:[]};
      out.groups.push(group);
      if(!Array.isArray(items)){issue('invalid_group_items',reference);continue;}
      const start=out.occurrences.length;
      for(const item of items)record(item,view,reference);
      group.sourceIds=[...new Set(out.occurrences.slice(start).map(r=>r.source.uyapDosyaId).filter(Boolean))];
    }
  }
  groups(data.tumEvraklar,'tumEvraklar');
  if(Object.hasOwn(data,'son20Evrak')){
    if(Array.isArray(data.son20Evrak))for(const item of data.son20Evrak)record(item,'son20Evrak',null);
    else issue('unsupported_recent_view_shape');
  }
  out.logicalDocuments=[...logical.values()];out.counts.logicalIdentities=logical.size;
  out.completeness.structure=!out.issues.some(i=>!['document_id_missing_or_invalid','source_id_missing_or_invalid'].includes(i.code));
  out.parseState=out.completeness.structure?'parsed':'partial';
  out.state=out.parseState==='partial'?'partial':out.counts.mainOccurrences===0&&out.counts.recentMainOccurrences===0?'empty':'parsed';
  if(!binding.verified)out.importBlockers.push(binding.reason);
  if(context.captureComplete!==true)out.importBlockers.push('capture_completeness_unverified');
  if(!out.completeness.structure)out.importBlockers.push('partial_response');
  if(out.occurrences.some(o=>o.relationshipState!=='verified'||!o.source.evrakId))out.importBlockers.push('source_relationship_unverified');
  if(out.occurrences.some(o=>o.permission==='reported_denied'))out.importBlockers.push('document_permission_denied');
  out.importBlockers.push('pagination_semantics_unverified');
  return out;
}

function selectGroupsForReview(parsed,references){
  if(!Array.isArray(references)||new Set(references).size!==references.length||
    references.some(r=>!parsed.groups.some(g=>g.reference===r)))throw Error('unknown_or_duplicate_group');
  // Selection affects display only; source ownership and group provenance survive.
  return {...parsed,groups:parsed.groups.map(g=>({...g,relationshipState:references.includes(g.reference)?'user_selected_unverified':g.relationshipState})),
    selectedGroupReferences:[...references],metadataImportAllowed:false,downloadAllowed:false};
}
module.exports={VERSION,PATH,RESPONSE_CONTRACT,MAIN_FIELDS,ATTACHMENT_FIELDS,parseCbsDocumentList,bindingState,selectGroupsForReview};
