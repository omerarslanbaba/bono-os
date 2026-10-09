"use strict";

const linked=require("./uyap_linked_legal_case_contract");

const CONTRACT_VERSION="bono.cbs-document-list-linked-compat.v1";
const SOURCE_CONTRACT="bono.cbs-document-list.v1";
const LINKED_ADAPTER_CONTRACT="bono.cbs-linked-document-adapter.v1";

const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
const opaque=v=>typeof v==="string"&&v.length>0?v:null;
const scalar=v=>v===null||["string","boolean"].includes(typeof v)||(typeof v==="number"&&Number.isFinite(v));

function exactLogicalKey(dosyaId,evrakId){
  const d=opaque(dosyaId),e=opaque(evrakId);
  return d&&e?JSON.stringify([d,e]):null;
}

function validateGraph(input){
  return input?.contractVersion===linked.CONTRACT_VERSION&&typeof input?.valid==="boolean"
    ? input
    : linked.validateLinkedLegalCaseGraph(input||{});
}

function caseForDosyaId(graph,dosyaId){
  const id=opaque(dosyaId);
  if(!id)return null;
  return (graph.cases||[]).find(c=>c?.identity?.uyapDosyaId===id)||null;
}

function groupByReference(parsed,reference){
  if(!reference)return null;
  return (parsed.groups||[]).find(g=>g?.reference===reference)||null;
}

function preserveKnownMetadata(occurrence){
  const m=occurrence?.metadata||{};
  const result={};
  for(const field of ["dosyaId","evrakId","ggEvrakId","anaEvrakId","sira","ekTuru"]){
    if(own(m,field)&&scalar(m[field]))result[field]=m[field];
  }
  if(occurrence?.kind==="attachment"&&own(occurrence,"reportedParentId")&&scalar(occurrence.reportedParentId)){
    result.anaEvrakId=occurrence.reportedParentId;
  }
  return result;
}

function sourceIdentity(graph,occurrence){
  const dosyaId=opaque(occurrence?.source?.uyapDosyaId);
  const evrakId=opaque(occurrence?.source?.evrakId);
  if(!dosyaId||!evrakId){
    return {
      state:"unknown",caseNodeId:null,uyapDosyaId:dosyaId,evrakId,
      reason:!dosyaId?"source_dosya_id_missing":"document_evrak_id_missing"
    };
  }
  const sourceCase=caseForDosyaId(graph,dosyaId);
  if(!sourceCase){
    return {
      state:"unknown",caseNodeId:null,uyapDosyaId:dosyaId,evrakId,
      reason:"source_case_not_in_linked_graph"
    };
  }
  return {
    state:sourceCase.identity?.state==="verified"?"verified":"unverified",
    caseNodeId:sourceCase.nodeId,
    uyapDosyaId:dosyaId,
    evrakId,
    unitName:sourceCase.identity?.unitName||null,
    fileNo:sourceCase.identity?.fileNo||null,
    reason:sourceCase.identity?.state==="verified"?null:"source_case_identity_not_verified"
  };
}

function parserEvidenceReady(parsed){
  return parsed?.state==="parsed"&&
    parsed?.parseState==="parsed"&&
    parsed?.binding?.verified===true&&
    parsed?.completeness?.capture===true&&
    parsed?.completeness?.structure===true;
}

function displayIdentityState(graph,parsed,displayCaseNodeId){
  const display=(graph.cases||[]).find(c=>c.nodeId===displayCaseNodeId)||null;
  if(!display)return {verified:false,reason:"display_case_missing",case:null};
  const panelIds=[...new Set((parsed.occurrences||[]).map(o=>opaque(o?.visibleFromUyapDosyaId)).filter(Boolean))];
  if(panelIds.length!==1)return {verified:false,reason:panelIds.length?"multiple_visible_from_ids":"visible_from_id_missing",case:display};
  if(display.identity?.state!=="verified")return {verified:false,reason:"display_case_identity_not_verified",case:display};
  if(display.identity.uyapDosyaId!==panelIds[0])return {verified:false,reason:"display_case_identity_mismatch",case:display};
  return {verified:true,reason:null,case:display,uyapDosyaId:panelIds[0]};
}

function linkedProjection(graph,parsed,source,displayState,viewPathsBySourceCaseNodeId={}){
  const base={
    visible:false,state:"unknown",mayAutoInclude:false,changesOwnership:false,
    sourceUnchanged:true
  };
  if(!parserEvidenceReady(parsed))return {...base,reason:"parser_evidence_not_ready"};
  if(!displayState.verified)return {...base,reason:displayState.reason};
  if(source.state!=="verified"||!source.caseNodeId)return {...base,reason:source.reason||"source_identity_not_verified"};
  const sourceCase=caseForDosyaId(graph,source.uyapDosyaId);
  const doc={
    documentKey:exactLogicalKey(source.uyapDosyaId,source.evrakId),
    source:{
      caseNodeId:source.caseNodeId,
      uyapDosyaId:source.uyapDosyaId,
      unitName:sourceCase?.identity?.unitName||null,
      fileNo:sourceCase?.identity?.fileNo||null,
      evrakId:source.evrakId,
      ownershipState:"verified"
    }
  };
  const path=source.caseNodeId===displayState.case.nodeId
    ? []
    : (viewPathsBySourceCaseNodeId[source.caseNodeId]||[]);
  const projection=linked.projectDocumentView(graph,doc,displayState.case.nodeId,{viaLinkIds:path});
  if(source.caseNodeId===displayState.case.nodeId&&
    parsed.occurrences?.some(o=>
      o?.source?.uyapDosyaId===source.uyapDosyaId&&
      o?.source?.evrakId===source.evrakId&&
      o?.relationshipState!=="verified"
    )){
    return {...base,reason:"parser_target_ownership_not_verified"};
  }
  return projection;
}

function occurrenceErrors(occurrence,preserved){
  const errors=[];
  const source=occurrence?.source||{};
  const d=opaque(source.uyapDosyaId),e=opaque(source.evrakId);
  if(source.uyapDosyaId!=null&&!d)errors.push("source_dosya_id_type_invalid");
  if(source.evrakId!=null&&!e)errors.push("source_evrak_id_type_invalid");
  if(own(preserved,"dosyaId")&&preserved.dosyaId!==source.uyapDosyaId)errors.push("metadata_dosya_id_mismatch");
  if(own(preserved,"evrakId")&&preserved.evrakId!==source.evrakId)errors.push("metadata_evrak_id_mismatch");
  if(occurrence?.kind==="attachment"&&own(occurrence?.metadata,"anaEvrakId")&&
    !Object.is(occurrence.metadata.anaEvrakId,occurrence.reportedParentId)){
    errors.push("attachment_parent_id_mismatch");
  }
  const expected=exactLogicalKey(source.uyapDosyaId,source.evrakId);
  if(expected&&occurrence.logicalKey!==expected)errors.push("logical_key_mismatch");
  if(!["main","attachment"].includes(occurrence?.kind))errors.push("occurrence_kind_invalid");
  if(!["tumEvraklar","son20Evrak"].includes(occurrence?.view))errors.push("occurrence_view_invalid");
  return errors;
}

function adaptCbsDocumentListOutput({
  parsed={},
  linkedCaseGraph={},
  displayCaseNodeId=null,
  viewPathsBySourceCaseNodeId={}
}={}){
  const graph=validateGraph(linkedCaseGraph);
  const errors=[];
  if(parsed?.contractVersion!==SOURCE_CONTRACT)errors.push({code:"parser_contract_mismatch"});
  if(!graph.valid)errors.push({code:"linked_case_graph_invalid"});
  if(!Array.isArray(parsed?.groups))errors.push({code:"parser_groups_missing"});
  if(!Array.isArray(parsed?.occurrences))errors.push({code:"parser_occurrences_missing"});
  if(!Array.isArray(parsed?.logicalDocuments))errors.push({code:"parser_logical_documents_missing"});
  const display=displayIdentityState(graph,parsed,displayCaseNodeId);

  const occurrences=[];
  const legal=new Map();
  const evrakSources=new Map();
  for(const raw of Array.isArray(parsed?.occurrences)?parsed.occurrences:[]){
    const preserved=preserveKnownMetadata(raw);
    for(const code of occurrenceErrors(raw,preserved))errors.push({scope:raw?.reference||"occurrence",code});

    const source=sourceIdentity(graph,raw);
    const group=groupByReference(parsed,raw?.groupReference);
    const projection=linkedProjection(graph,parsed,source,display,viewPathsBySourceCaseNodeId);
    const key=exactLogicalKey(source.uyapDosyaId,source.evrakId);
    const legalKey=key||JSON.stringify(["unknown-source",raw?.reference||String(occurrences.length)]);
    const occurrence={
      occurrenceId:raw?.reference||null,
      surface:raw?.view||null,
      parserGroupReference:raw?.groupReference||null,
      parserGroup:{
        display:group?.display||null,
        relationshipState:group?.relationshipState||"unknown",
        sourceIds:Array.isArray(group?.sourceIds)?[...group.sourceIds]:[],
        contextOnly:true,
        provesSource:false,
        provesRelationType:false,
        provesVerifiedLink:false
      },
      documentRole:raw?.kind||null,
      legalDocumentKey:legalKey,
      source:{
        ...source,
        parserOwnershipState:raw?.source?.ownershipState||"unknown",
        parserRelationshipState:raw?.relationshipState||"unknown"
      },
      metadata:preserved,
      attachment:raw?.kind==="attachment"?{
        parentReference:raw?.parentReference||null,
        anaEvrakId:own(preserved,"anaEvrakId")?preserved.anaEvrakId:null,
        sira:own(preserved,"sira")?preserved.sira:null,
        ekTuru:own(preserved,"ekTuru")?preserved.ekTuru:null,
        parentIdentityEquality:raw?.parentIdentityEquality||"unknown",
        sourceInheritedFromParent:false
      }:null,
      observedView:{
        visible:true,
        visibleFromUyapDosyaId:opaque(raw?.visibleFromUyapDosyaId),
        visibleFromCaseNodeId:displayCaseNodeId,
        basis:"bono.cbs-document-list.v1",
        provesLegalRelationship:false,
        changesOwnership:false
      },
      linkedProjection:projection,
      automaticRelatedScopeCandidate:projection?.mayAutoInclude===true&&source.state==="verified",
      runtimeMetadataImportAllowed:false,
      runtimeDownloadAllowed:false
    };
    occurrences.push(occurrence);

    if(source.evrakId&&source.uyapDosyaId){
      if(!evrakSources.has(source.evrakId))evrakSources.set(source.evrakId,new Set());
      evrakSources.get(source.evrakId).add(source.uyapDosyaId);
    }
    if(!legal.has(legalKey)){
      legal.set(legalKey,{
        legalDocumentKey:legalKey,
        source:{
          state:source.state,
          caseNodeId:source.caseNodeId,
          uyapDosyaId:source.uyapDosyaId,
          evrakId:source.evrakId
        },
        occurrenceIds:[],
        roles:[],
        automaticRelatedScopeCandidate:false
      });
    }
    const doc=legal.get(legalKey);
    doc.occurrenceIds.push(occurrence.occurrenceId);
    if(!doc.roles.includes(occurrence.documentRole))doc.roles.push(occurrence.documentRole);
    doc.automaticRelatedScopeCandidate=doc.automaticRelatedScopeCandidate||occurrence.automaticRelatedScopeCandidate;
  }

  const parserLogical=new Map();
  for(const d of Array.isArray(parsed?.logicalDocuments)?parsed.logicalDocuments:[]){
    if(typeof d?.key!=="string"){errors.push({scope:"logicalDocument",code:"parser_logical_key_invalid"});continue;}
    if(parserLogical.has(d.key))errors.push({scope:d.key,code:"parser_duplicate_logical_key"});
    parserLogical.set(d.key,d);
    const expected=exactLogicalKey(d?.source?.uyapDosyaId,d?.source?.evrakId);
    if(!expected||expected!==d.key)errors.push({scope:d.key,code:"parser_logical_source_mismatch"});
  }
  for(const [key,doc] of legal){
    if(doc.source.uyapDosyaId&&doc.source.evrakId&&!parserLogical.has(key)){
      errors.push({scope:key,code:"parser_logical_document_missing"});
    }
  }

  const collisions=[];
  for(const [evrakId,sources] of evrakSources){
    if(sources.size>1)collisions.push({
      evrakId,
      distinctSourceCount:sources.size,
      decision:"keep_separate_by_exact_dosya_id_plus_evrak_id"
    });
  }

  return {
    contractVersion:CONTRACT_VERSION,
    sourceContractVersion:SOURCE_CONTRACT,
    linkedAdapterContract:LINKED_ADAPTER_CONTRACT,
    valid:errors.length===0,
    errors,
    parserEvidenceReady:parserEvidenceReady(parsed),
    displayCase:{
      nodeId:displayCaseNodeId,
      identityVerified:display.verified,
      reason:display.reason||null,
      uyapDosyaId:display.uyapDosyaId||null
    },
    groups:(Array.isArray(parsed?.groups)?parsed.groups:[]).map(g=>({
      reference:g?.reference||null,
      view:g?.view||null,
      display:g?.display||null,
      relationshipState:g?.relationshipState||"unknown",
      sourceIds:Array.isArray(g?.sourceIds)?[...g.sourceIds]:[],
      contextOnly:true,
      mayCreateSourceCase:false,
      provesRelationType:false,
      provesVerifiedLink:false
    })),
    occurrences,
    legalDocuments:[...legal.values()],
    identityDiagnostics:{
      dedupKey:"json_tuple_exact_dosya_id_evrak_id",
      evrakIdAloneIsUnique:false,
      evrakIdCollisions:collisions,
      opaqueIdsNormalized:false,
      missingAttachmentSourceInherited:false
    },
    safety:{
      groupDisplayContextOnly:true,
      parserGroupSelectionDoesNotVerifyOccurrence:true,
      parserVisibilityDoesNotVerifyRelationship:true,
      userSelectedUnverifiedAutoIncluded:false,
      metadataImportAllowed:false,
      downloadAllowed:false
    }
  };
}

module.exports={
  CONTRACT_VERSION,
  SOURCE_CONTRACT,
  LINKED_ADAPTER_CONTRACT,
  exactLogicalKey,
  adaptCbsDocumentListOutput
};
