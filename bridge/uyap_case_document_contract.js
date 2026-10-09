"use strict";

function trFold(value){
  return String(value??"")
    .replace(/İ/g,"I").replace(/ı/g,"i")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function normalizeCourt(value){
  return trFold(value)
    .replace(/\b(mahkemesi|mahkeme|hakimligi|hakimlik|dairesi|daire)\b/g," ")
    .replace(/\s+/g," ").trim();
}
function normalizeFileNo(value){
  const m=String(value??"").match(/(20\d{2})\s*\/\s*(\d+)/);
  return m?m[1]+"/"+String(Number(m[2])):trFold(value);
}
function opaqueId(value){
  const s=String(value??"").trim();
  return s||null;
}
function exactCaseTarget({court,fileNo,uyapDosyaId}={}){
  return {
    court:String(court||"").trim()||null,
    courtKey:normalizeCourt(court),
    fileNo:String(fileNo||"").trim()||null,
    fileNoKey:normalizeFileNo(fileNo),
    uyapDosyaId:opaqueId(uyapDosyaId)
  };
}
function verifyCaseIdentity(target,observed,{source="unknown",liveObserved=false}={}){
  const expected=exactCaseTarget(target||{});
  const got=exactCaseTarget({
    court:observed?.court??observed?.birimAdi,
    fileNo:observed?.fileNo??observed?.dosyaNo,
    uyapDosyaId:observed?.uyapDosyaId??observed?.dosyaId
  });
  const missing=[];
  if(!expected.courtKey)missing.push("target_court");
  if(!expected.fileNoKey)missing.push("target_file_no");
  if(!got.courtKey)missing.push("observed_court");
  if(!got.fileNoKey)missing.push("observed_file_no");
  if(!got.uyapDosyaId)missing.push("observed_dosya_id");
  if(missing.length){
    return {state:"unverified",verified:false,reason:"missing_identity_fields",missing,source,liveObserved,expected,observed:got};
  }
  if(expected.courtKey!==got.courtKey||expected.fileNoKey!==got.fileNoKey){
    return {state:"mismatch",verified:false,reason:"court_or_file_number_mismatch",source,liveObserved,expected,observed:got};
  }
  if(expected.uyapDosyaId&&expected.uyapDosyaId!==got.uyapDosyaId){
    return {state:"mismatch",verified:false,reason:"opaque_case_id_mismatch",source,liveObserved,expected,observed:got};
  }
  return {
    state:"verified",
    verified:true,
    reason:null,
    source,
    liveObserved,
    identity:{
      court:got.court,
      courtKey:got.courtKey,
      fileNo:got.fileNo,
      fileNoKey:got.fileNoKey,
      uyapDosyaId:got.uyapDosyaId
    }
  };
}
function documentListItems(data){
  const rows=[];
  if(Array.isArray(data?.tumEvraklar)){
    for(const item of data.tumEvraklar)rows.push({item,group:null});
    return {recognized:true,shape:"tumEvraklar.array",rows};
  }
  if(data?.tumEvraklar&&typeof data.tumEvraklar==="object"&&!Array.isArray(data.tumEvraklar)){
    for(const [group,items] of Object.entries(data.tumEvraklar)){
      if(!Array.isArray(items))continue;
      for(const item of items)rows.push({item,group:String(group)});
    }
    return {recognized:true,shape:"tumEvraklar.grouped",rows};
  }
  if(Array.isArray(data?.son20Evrak)){
    for(const item of data.son20Evrak)rows.push({item,group:"son20Evrak"});
    return {recognized:true,shape:"son20Evrak.array",rows};
  }
  return {recognized:false,shape:"unknown",rows:[]};
}
function classifyDocumentOwnership(caseIdentity,item,{group=null}={}){
  const targetId=opaqueId(caseIdentity?.uyapDosyaId||caseIdentity?.identity?.uyapDosyaId);
  const docCaseId=opaqueId(item?.dosyaId);
  const documentId=opaqueId(item?.evrakId);
  const base={group:group||item?.__uyapGroup||null,targetUyapDosyaId:targetId,documentUyapDosyaId:docCaseId,remoteDocumentId:documentId};
  if(!targetId)return {...base,state:"unverified",bind:false,reason:"target_case_id_missing"};
  if(!docCaseId)return {...base,state:"unverified",bind:false,reason:"document_case_id_missing"};
  if(docCaseId!==targetId)return {...base,state:"foreign",bind:false,reason:"document_belongs_to_different_case"};
  if(!documentId)return {...base,state:"unverified",bind:false,reason:"document_id_missing"};
  return {...base,state:"owned",bind:true,reason:null,ownershipKey:targetId+"::"+documentId};
}
function validateDocumentListOwnership(caseIdentity,data){
  const parsed=documentListItems(data);
  if(!parsed.recognized){
    return {
      state:"rejected",
      accepted:false,
      reason:"unsupported_document_list_shape",
      shape:parsed.shape,
      total:0,
      owned:[],
      foreign:[],
      unverified:[]
    };
  }
  const owned=[],foreign=[],unverified=[];
  for(const row of parsed.rows){
    const evidence=classifyDocumentOwnership(caseIdentity,row.item,{group:row.group});
    const record={item:row.item,group:row.group,evidence};
    if(evidence.state==="owned")owned.push(record);
    else if(evidence.state==="foreign")foreign.push(record);
    else unverified.push(record);
  }
  const state=foreign.length||unverified.length
    ? (owned.length?"partial":"rejected")
    : "verified";
  return {
    state,
    accepted:state==="verified",
    failClosed:state!=="verified",
    reason:state==="verified"?null:(owned.length?"mixed_or_unverified_document_ownership":"no_verified_owned_documents"),
    shape:parsed.shape,
    total:parsed.rows.length,
    owned,
    foreign,
    unverified,
    counts:{owned:owned.length,foreign:foreign.length,unverified:unverified.length}
  };
}
function verifyPersistedRemoteOwnership(caseIdentity,remoteRow){
  let meta={};
  try{meta=remoteRow?.metadata_json?JSON.parse(remoteRow.metadata_json):(remoteRow?.metadata||{})}catch{
    return {state:"unverified",verified:false,reason:"metadata_json_invalid"};
  }
  const evidence=classifyDocumentOwnership(caseIdentity,meta,{group:meta?.__uyapGroup||null});
  if(!evidence.bind)return {...evidence,verified:false};
  const storedRemoteId=opaqueId(remoteRow?.remote_document_id);
  if(!storedRemoteId)return {...evidence,state:"unverified",verified:false,bind:false,reason:"stored_remote_document_id_missing"};
  if(storedRemoteId!==evidence.remoteDocumentId){
    return {...evidence,state:"mismatch",verified:false,bind:false,reason:"stored_remote_document_id_mismatch",storedRemoteDocumentId:storedRemoteId};
  }
  return {...evidence,state:"verified",verified:true,bind:true,storedRemoteDocumentId:storedRemoteId};
}
function stage(state,evidence={}){return {state,...evidence}}
function buildSingleCaseLifecycle({
  caseIdentity=null,
  documentList=null,
  metadataRows=[],
  physicalDocuments=[]
}={}){
  const caseStage=caseIdentity?.verified
    ? stage("found_verified",{verified:true})
    : caseIdentity?.state==="mismatch"
      ? stage("identity_mismatch",{verified:false,reason:caseIdentity.reason})
      : caseIdentity
        ? stage("found_unverified",{verified:false,reason:caseIdentity.reason||"identity_not_verified"})
        : stage("not_found",{verified:false});

  let listStage=stage("not_requested",{verified:false});
  if(documentList){
    if(documentList.queryState==="queued")listStage=stage("queued",{verified:false});
    else if(documentList.queryState==="running")listStage=stage("running",{verified:false});
    else if(documentList.queryState==="failed")listStage=stage("failed",{verified:false,reason:documentList.reason||"query_failed"});
    else if(documentList.validation?.state==="verified")listStage=stage("completed_verified",{verified:true,count:documentList.validation.total});
    else if(documentList.validation?.state==="partial")listStage=stage("completed_partial",{verified:false,count:documentList.validation.total,counts:documentList.validation.counts});
    else if(documentList.validation)listStage=stage("completed_unverified",{verified:false,reason:documentList.validation.reason});
  }

  const metaVerified=metadataRows.filter(x=>x?.verified===true).length;
  const metaRejected=metadataRows.length-metaVerified;
  const metadataStage=metadataRows.length===0
    ? stage("none",{verifiedCount:0,rejectedCount:0})
    : metaRejected===0
      ? stage("verified",{verifiedCount:metaVerified,rejectedCount:0})
      : metaVerified>0
        ? stage("partial",{verifiedCount:metaVerified,rejectedCount:metaRejected})
        : stage("rejected",{verifiedCount:0,rejectedCount:metaRejected});

  const downloaded=physicalDocuments.filter(x=>x?.downloaded===true).length;
  const hashVerified=physicalDocuments.filter(x=>x?.hashVerified===true).length;
  const downloadStage=physicalDocuments.length===0
    ? stage("none",{downloadedCount:0,total:0})
    : downloaded===physicalDocuments.length
      ? stage("downloaded",{downloadedCount:downloaded,total:physicalDocuments.length})
      : downloaded>0
        ? stage("partial",{downloadedCount:downloaded,total:physicalDocuments.length})
        : stage("not_downloaded",{downloadedCount:0,total:physicalDocuments.length});
  const integrityStage=physicalDocuments.length===0
    ? stage("none",{verifiedCount:0,total:0})
    : hashVerified===physicalDocuments.length
      ? stage("verified",{verifiedCount:hashVerified,total:physicalDocuments.length})
      : hashVerified>0
        ? stage("partial",{verifiedCount:hashVerified,total:physicalDocuments.length})
        : stage("unverified",{verifiedCount:0,total:physicalDocuments.length});

  return {
    contractVersion:"uyap.single-case-evidence.v1",
    caseDiscovery:caseStage,
    documentList:listStage,
    metadataBinding:metadataStage,
    download:downloadStage,
    integrity:integrityStage
  };
}
function queryCapability(request,{caseSearchSchemaVerified=false,cbsSearchSchemaVerified=false,cbsPartyLookupVerified=false}={}){
  const kind=String(request?.kind||"");
  if(kind==="linked_case_document_refresh"){
    const hasCase=Number.isFinite(Number(request?.caseId))&&Number(request.caseId)>0;
    const hasOpaque=!!opaqueId(request?.uyapDosyaId);
    return {
      supported:hasCase&&hasOpaque,
      executable:hasCase&&hasOpaque,
      route:"existing:enqueueCaseDocumentSync",
      reason:hasCase&&hasOpaque?"linked_case_document_list_contract_verified":"verified_case_link_required"
    };
  }
  if(kind==="targeted_case_search"){
    const hasInputs=!!request?.court&&Number(request?.year)>0&&Number(request?.baseNumber)>0&&
      Number(request?.yargiTuru)>0&&!!String(request?.birimTuru2||"").trim();
    return {
      supported:caseSearchSchemaVerified&&hasInputs,
      executable:caseSearchSchemaVerified&&hasInputs,
      route:"existing:enqueueTargetedCaseSearch",
      reason:!caseSearchSchemaVerified?"observed_case_search_schema_required":(hasInputs?"observed_schema_exact_response_match":"required_inputs_missing")
    };
  }
  if(kind==="cbs_party_search"){
    const hasInputs=Number(request?.ilKodu)>0&&!!String(request?.birimId||"").trim()&&
      !!String(request?.partyName||"").trim()&&!!request?.openedFrom&&!!request?.openedTo;
    const verified=cbsSearchSchemaVerified&&cbsPartyLookupVerified;
    return {
      supported:verified&&hasInputs,
      executable:verified&&hasInputs,
      route:"existing:enqueueTargetedCbsPartySearch",
      reason:!verified?"observed_cbs_and_party_schemas_required":(hasInputs?"observed_schema_exact_party_match":"required_inputs_missing")
    };
  }
  if(kind==="cbs_investigation_number_search"){
    return {supported:false,executable:false,route:null,reason:"direct_cbs_number_query_schema_not_observed"};
  }
  if(kind==="talimat_direct_search"){
    return {supported:false,executable:false,route:null,reason:"talimat_query_and_group_ownership_not_observed"};
  }
  return {supported:false,executable:false,route:null,reason:"unsupported_query_kind"};
}

module.exports={
  // CBS review output is deliberately separate from the legacy import validator.
  // Calling this pure adapter cannot enqueue, persist or authorize documents.
  parseCbsDocumentList:require('./uyap_cbs_document_parser').parseCbsDocumentList,
  normalizeCourt,
  normalizeFileNo,
  exactCaseTarget,
  verifyCaseIdentity,
  documentListItems,
  classifyDocumentOwnership,
  validateDocumentListOwnership,
  verifyPersistedRemoteOwnership,
  buildSingleCaseLifecycle,
  queryCapability
};
