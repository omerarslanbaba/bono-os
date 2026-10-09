'use strict';
// Read-only evidence review, not a portal parser or permission to import/download.
const fileNo=/^20\d{2}\/[1-9]\d*$/;
const ref=/^[a-f0-9]{64}$/;
function reviewSources(event){
 const graph=event?.identityGraph,nodes=graph?.nodes;
 const captureReference=/^[a-zA-Z0-9-]{8,100}$/.test(event?.sessionId||'')&&/^[a-zA-Z0-9-]{8,100}$/.test(event?.eventId||'')?event.sessionId+':'+event.eventId:null;
 const blocked=!captureReference||!Array.isArray(nodes)||!nodes.length||event?.caseBinding!=='request_id_matches_user_confirmed_case'||event?.capture?.complete!==true||graph?.complete!==true||event?.applicationError||event?.status!==200;
 const groups=[],documents=[],byNode=new Map();let invalid=false;
 for(const n of Array.isArray(nodes)?nodes:[]){
  if(!Number.isSafeInteger(n.node)||n.node<0||byNode.has(n.node)||!(n.parent===null||byNode.has(n.parent))){invalid=true;break;}
  const parent=byNode.get(n.parent),label=n.edge?.group;
  const group=label&&fileNo.test(label.caseNo||'')?{
   reference:captureReference+':node:'+n.node,parentGroup:parent?.group?.reference||null,
   caseNo:label.caseNo,type:['cbs_investigation','instruction'].includes(label.type)?label.type:'unknown',
   sourceReference:ref.test(n.ids?.dosyaId||'')?n.ids.dosyaId:null,
   sourceSemantics:'unknown',ownership:'unverified',documentCount:0,missingSourceCount:0,
   defaultSelected:false,selectionPurpose:'review_only',metadataImportAllowed:false,downloadAllowed:false
  }:null;
  if(group)groups.push(group);
  const active=group||parent?.group||null;byNode.set(n.node,{group:active});
  if(ref.test(n.ids?.evrakId||'')){
   const source=ref.test(n.ids?.dosyaId||'')?n.ids.dosyaId:null;
   documents.push({node:n.node,groupReference:active?.reference||null,sourceReference:source,
    documentReference:n.ids.evrakId,sourceEqualsRequest:source?source===event.requestReference:null,
    sourceEqualsGroup:source&&active?.sourceReference?source===active.sourceReference:null,
    ownership:'unverified',downloadReference:'unknown'});
   if(active){active.documentCount++;if(!source)active.missingSourceCount++;}
  }
 }
 return {captureReference,state:blocked||invalid?'blocked':'review_required',reason:invalid?'invalid_identity_graph':blocked?'incomplete_or_unbound_response':'source_semantics_not_verified',
  groups:invalid?[]:groups,documents:invalid?[]:documents,documentIdentityCount:invalid?0:documents.length,
  uniqueDocumentIdentityCount:invalid?0:new Set(documents.map(d=>d.documentReference)).size,
  complete:!blocked&&!invalid,legalRelationship:'unknown',metadataImportAllowed:false,downloadAllowed:false};
}
function selectForReview(review,references){
 if(!Array.isArray(references)||new Set(references).size!==references.length||references.some(r=>!review.groups.some(g=>g.reference===r)))throw Error('unknown_or_duplicate_group');
 return {selectedGroups:review.groups.filter(g=>references.includes(g.reference)),purpose:'review_only',
  metadataImportAllowed:false,downloadAllowed:false,reason:'user_selection_is_not_source_ownership_proof'};
}
function auditIdentityHistory(db,caseId){
 const c=db.prepare('SELECT uyap_dosya_id,uyap_birim_id,court_file_no FROM cases WHERE id=?').get(Number(caseId));
 if(!c)throw Error('case_not_found');
 const evidence=[];
 for(const row of db.prepare("SELECT q.id,q.result_json,q.finished_at FROM uyap_query_history h JOIN uyap_command_queue q ON q.id=h.command_id WHERE h.case_id=? AND h.operation='cbs.search' AND q.status='completed' ORDER BY q.id").all(Number(caseId))){
  let data;try{data=JSON.parse(row.result_json)}catch{continue;}
  const matches=Array.isArray(data?.[0])?data[0].filter(r=>r?.dosyaNo===c.court_file_no&&String(r.birimId)===String(c.uyap_birim_id)&&typeof r.dosyaId==='string'&&r.dosyaId):[];
  if(matches.length!==1)continue;
  evidence.push({commandId:row.id,resultRef:'command:'+row.id,at:row.finished_at,id:matches[0].dosyaId});
 }
 const transitions=evidence.slice(1).filter((r,i)=>r.id!==evidence[i].id).map(r=>({resultRef:r.resultRef,identityChanged:true}));
 return {caseId:Number(caseId),evidence:evidence.map(({id,...r})=>({...r,matchesCurrent:id===c.uyap_dosya_id})),transitions,
  opaqueIdLifetime:'unknown',oldAndNewEquivalent:'unverified',automaticAliasAllowed:false,
  linkedRemoteDocuments:db.prepare('SELECT count(*) n FROM uyap_remote_documents WHERE case_id=?').get(Number(caseId)).n,
  documentLinksRequireRevalidation:transitions.length>0,historyModified:false};
}
module.exports={reviewSources,selectForReview,auditIdentityHistory};
