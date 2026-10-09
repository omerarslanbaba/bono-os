"use strict";

const CONTRACT_VERSION="bono.linked-legal-cases.v1";

const CASE_IDENTITY_STATES=new Set(["verified","unverified","unknown"]);
const LINK_STATES=new Set(["verified","user_selected_unverified","unknown"]);
const RELATION_TYPES=new Set([
  "cbs_successor",
  "prosecution_to_court",
  "instruction_child",
  "appeal_to",
  "related_other"
]);

function text(value){
  const s=String(value??"").trim();
  return s||null;
}

function caseIdentityKey(identity={}){
  const dosyaId=text(identity.uyapDosyaId);
  return dosyaId?`uyap:${dosyaId}`:null;
}

function documentSourceKey(source={}){
  const dosyaId=text(source.uyapDosyaId);
  const evrakId=text(source.evrakId);
  return dosyaId&&evrakId?`${dosyaId}::${evrakId}`:null;
}

function validSha256(value){
  return /^[a-f0-9]{64}$/i.test(String(value||"").trim());
}

function normalizeCaseNode(input={}){
  const identity=input.identity||{};
  return {
    nodeId:text(input.nodeId),
    bonoCaseId:input.bonoCaseId??null,
    caseKind:text(input.caseKind)||"unknown",
    stage:text(input.stage),
    identity:{
      state:text(identity.state)||"unknown",
      uyapDosyaId:text(identity.uyapDosyaId),
      unitName:text(identity.unitName),
      unitId:text(identity.unitId),
      fileNo:text(identity.fileNo)
    }
  };
}

function linkPolicy(state){
  if(state==="verified"){
    return {
      mayAutoTraverse:true,
      mayDefaultIncludeRelatedDocuments:true,
      requiresUserChoice:false,
      labelTr:"Bağlantı doğrulandı"
    };
  }
  if(state==="user_selected_unverified"){
    return {
      mayAutoTraverse:false,
      mayDefaultIncludeRelatedDocuments:false,
      requiresUserChoice:true,
      labelTr:"Kullanıcı tarafından ilişkilendirildi; doğrulanmadı"
    };
  }
  return {
    mayAutoTraverse:false,
    mayDefaultIncludeRelatedDocuments:false,
    requiresUserChoice:true,
    labelTr:"Dosya bağlantısı bilinmiyor"
  };
}

function normalizeLink(input={}){
  const evidence=input.evidence||{};
  const state=text(input.state)||"unknown";
  return {
    linkId:text(input.linkId),
    fromCaseNodeId:text(input.fromCaseNodeId),
    toCaseNodeId:text(input.toCaseNodeId),
    relationType:text(input.relationType)||"related_other",
    state,
    evidence:{
      kind:text(evidence.kind)||"unknown",
      verified:evidence.verified===true,
      userSelected:evidence.userSelected===true,
      source:text(evidence.source),
      note:text(evidence.note)
    },
    policy:linkPolicy(state)
  };
}

function normalizeDocument(input={}){
  const source=input.source||{};
  const physical=input.physicalContent||{};
  return {
    documentKey:text(input.documentKey)||documentSourceKey(source),
    source:{
      caseNodeId:text(source.caseNodeId),
      uyapDosyaId:text(source.uyapDosyaId),
      unitName:text(source.unitName),
      fileNo:text(source.fileNo),
      evrakId:text(source.evrakId),
      ownershipState:text(source.ownershipState)||"unknown"
    },
    physicalContent:{
      sha256:text(physical.sha256)?.toLowerCase()||null,
      integrityVerified:physical.integrityVerified===true
    }
  };
}

function validateCaseNode(node){
  const errors=[];
  if(!node.nodeId)errors.push("case.node_id_required");
  const identity=node.identity||{};
  if(!CASE_IDENTITY_STATES.has(identity.state))errors.push("case.unsupported_identity_state");
  if(identity.state==="verified"){
    if(!identity.uyapDosyaId)errors.push("case.verified_identity_dosya_id_required");
    if(!identity.unitName)errors.push("case.verified_identity_unit_required");
    if(!identity.fileNo)errors.push("case.verified_identity_file_no_required");
  }
  return errors;
}

function validateLink(link,casesById){
  const errors=[];
  if(!link.linkId)errors.push("link.link_id_required");
  if(!link.fromCaseNodeId||!casesById.has(link.fromCaseNodeId))errors.push("link.from_case_missing");
  if(!link.toCaseNodeId||!casesById.has(link.toCaseNodeId))errors.push("link.to_case_missing");
  if(link.fromCaseNodeId&&link.fromCaseNodeId===link.toCaseNodeId)errors.push("link.self_relation_forbidden");
  if(!LINK_STATES.has(link.state))errors.push("link.unsupported_state");
  if(!RELATION_TYPES.has(link.relationType))errors.push("link.unsupported_relation_type");

  if(link.state==="verified"){
    const from=casesById.get(link.fromCaseNodeId);
    const to=casesById.get(link.toCaseNodeId);
    if(from?.identity?.state!=="verified"||to?.identity?.state!=="verified"){
      errors.push("link.verified_requires_verified_case_identities");
    }
    if(link.evidence?.verified!==true)errors.push("link.verified_evidence_required");
    if(["unknown","user_selection"].includes(String(link.evidence?.kind||""))){
      errors.push("link.verified_evidence_kind_invalid");
    }
  }else if(link.state==="user_selected_unverified"){
    if(link.evidence?.userSelected!==true||link.evidence?.kind!=="user_selection"){
      errors.push("link.user_selection_evidence_required");
    }
    if(link.evidence?.verified===true)errors.push("link.user_selected_must_remain_unverified");
  }else if(link.state==="unknown"&&link.evidence?.verified===true){
    errors.push("link.unknown_cannot_have_verified_evidence");
  }
  return errors;
}

function validateDocument(document,casesById){
  const errors=[];
  const source=document.source||{};
  const sourceCase=casesById.get(source.caseNodeId);
  if(!document.documentKey)errors.push("document.key_required");
  if(!source.caseNodeId||!sourceCase)errors.push("document.source_case_missing");
  if(!CASE_IDENTITY_STATES.has(source.ownershipState))errors.push("document.unsupported_ownership_state");
  if(source.ownershipState==="verified"){
    if(!source.uyapDosyaId)errors.push("document.verified_source_dosya_id_required");
    if(!source.evrakId)errors.push("document.verified_source_evrak_id_required");
  }
  if(sourceCase){
    const ci=sourceCase.identity||{};
    if(source.uyapDosyaId&&ci.uyapDosyaId&&source.uyapDosyaId!==ci.uyapDosyaId){
      errors.push("document.source_dosya_id_mismatch");
    }
    if(source.unitName&&ci.unitName&&source.unitName!==ci.unitName){
      errors.push("document.source_unit_mismatch");
    }
    if(source.fileNo&&ci.fileNo&&source.fileNo!==ci.fileNo){
      errors.push("document.source_file_no_mismatch");
    }
  }
  if(document.physicalContent?.integrityVerified===true&&!validSha256(document.physicalContent?.sha256)){
    errors.push("document.verified_integrity_requires_sha256");
  }
  return errors;
}

function validateLinkedLegalCaseGraph(input={}){
  const errors=[];
  const cases=(input.cases||[]).map(normalizeCaseNode);
  const links=(input.links||[]).map(normalizeLink);
  const documents=(input.documents||[]).map(normalizeDocument);

  const casesById=new Map();
  const uyapIds=new Map();
  for(const c of cases){
    for(const e of validateCaseNode(c))errors.push({scope:c.nodeId||"case",code:e});
    if(c.nodeId){
      if(casesById.has(c.nodeId))errors.push({scope:c.nodeId,code:"case.duplicate_node_id"});
      else casesById.set(c.nodeId,c);
    }
    const k=caseIdentityKey(c.identity);
    if(k){
      if(uyapIds.has(k)&&uyapIds.get(k)!==c.nodeId){
        errors.push({scope:c.nodeId||"case",code:"case.duplicate_uyap_dosya_id"});
      }else uyapIds.set(k,c.nodeId);
    }
  }

  const linkIds=new Set();
  const linkTupleKeys=new Set();
  for(const l of links){
    for(const e of validateLink(l,casesById))errors.push({scope:l.linkId||"link",code:e});
    if(l.linkId){
      if(linkIds.has(l.linkId))errors.push({scope:l.linkId,code:"link.duplicate_link_id"});
      linkIds.add(l.linkId);
    }
    if(l.fromCaseNodeId&&l.toCaseNodeId){
      const tuple=[l.fromCaseNodeId,l.toCaseNodeId,l.relationType].join("::");
      if(linkTupleKeys.has(tuple))errors.push({scope:l.linkId||"link",code:"link.duplicate_relation"});
      else linkTupleKeys.add(tuple);
    }
  }

  const docKeys=new Set();
  for(const d of documents){
    for(const e of validateDocument(d,casesById))errors.push({scope:d.documentKey||"document",code:e});
    if(d.documentKey){
      if(docKeys.has(d.documentKey))errors.push({scope:d.documentKey,code:"document.duplicate_document_key"});
      docKeys.add(d.documentKey);
    }
  }

  return {
    contractVersion:CONTRACT_VERSION,
    processId:text(input.processId),
    valid:errors.length===0,
    errors,
    cases,
    links,
    documents
  };
}

function findLink(graph,linkId){
  return (graph.links||[]).find(x=>x.linkId===linkId)||null;
}

function otherEndpoint(link,current){
  if(link.fromCaseNodeId===current)return link.toCaseNodeId;
  if(link.toCaseNodeId===current)return link.fromCaseNodeId;
  return null;
}

function aggregateLinkState(states){
  if(states.includes("unknown"))return "unknown";
  if(states.includes("user_selected_unverified"))return "user_selected_unverified";
  return states.length?"verified":"unknown";
}

function projectDocumentView(graphInput,documentInput,targetCaseNodeId,{viaLinkIds=[]}={}){
  const graph=graphInput?.contractVersion===CONTRACT_VERSION
    ? graphInput
    : validateLinkedLegalCaseGraph(graphInput);
  const document=normalizeDocument(documentInput);
  const target=text(targetCaseNodeId);
  const source=document.source?.caseNodeId;
  const base={
    contractVersion:"bono.document-view-projection.v1",
    sourceCaseNodeId:source,
    visibleFromCaseNodeId:target,
    documentKey:document.documentKey,
    source:document.source,
    sourceUnchanged:true,
    changesOwnership:false
  };

  if(!graph.valid)return {...base,visible:false,state:"invalid_graph",reason:"linked_case_graph_invalid"};
  if(!target||!graph.cases.some(x=>x.nodeId===target)){
    return {...base,visible:false,state:"unknown",reason:"target_case_missing"};
  }
  if(source===target){
    return {
      ...base,
      visible:true,
      state:"source_case",
      mayAutoInclude:true,
      viaLinkIds:[],
      labelTr:"Belgenin kendi kaynak dosyası"
    };
  }
  if(!Array.isArray(viaLinkIds)||viaLinkIds.length===0){
    return {...base,visible:false,state:"unknown",mayAutoInclude:false,viaLinkIds:[],reason:"relationship_path_required",labelTr:"Görünüm bağlantısı bilinmiyor"};
  }

  const states=[];
  const path=[];
  let current=source;
  for(const id of viaLinkIds){
    const link=findLink(graph,id);
    if(!link)return {...base,visible:false,state:"unknown",mayAutoInclude:false,viaLinkIds:path,reason:"relationship_link_missing",labelTr:"Görünüm bağlantısı bilinmiyor"};
    const next=otherEndpoint(link,current);
    if(!next)return {...base,visible:false,state:"unknown",mayAutoInclude:false,viaLinkIds:path,reason:"relationship_path_disconnected",labelTr:"Görünüm bağlantısı geçersiz"};
    path.push(id);
    states.push(link.state);
    current=next;
  }
  if(current!==target){
    return {...base,visible:false,state:"unknown",mayAutoInclude:false,viaLinkIds:path,reason:"relationship_path_wrong_target",labelTr:"Görünüm bağlantısı hedef dosyaya ulaşmıyor"};
  }

  const state=aggregateLinkState(states);
  if(state==="unknown"){
    return {...base,visible:false,state,mayAutoInclude:false,viaLinkIds:path,reason:"relationship_unverified",labelTr:"Bağlantı bilinmediği için belge otomatik gösterilemez"};
  }
  if(state==="user_selected_unverified"){
    return {...base,visible:true,state,mayAutoInclude:false,viaLinkIds:path,labelTr:"Kullanıcı seçimiyle gösteriliyor; bağlantı doğrulanmadı"};
  }
  return {...base,visible:true,state:"verified",mayAutoInclude:true,viaLinkIds:path,labelTr:"Doğrulanmış ilişkili dosyadan gösteriliyor"};
}

function buildPhysicalReuseIndex(documents=[]){
  const bySha={};
  const separateLegalRecords=[];
  for(const raw of documents){
    const d=normalizeDocument(raw);
    separateLegalRecords.push({
      documentKey:d.documentKey,
      sourceCaseNodeId:d.source.caseNodeId,
      sourceUyapDosyaId:d.source.uyapDosyaId,
      evrakId:d.source.evrakId,
      sha256:d.physicalContent.sha256
    });
    const sha=d.physicalContent.sha256;
    if(!d.physicalContent.integrityVerified||!validSha256(sha))continue;
    if(!bySha[sha])bySha[sha]={physicalContentKey:`sha256:${sha}`,documentKeys:[]};
    bySha[sha].documentKeys.push(d.documentKey);
  }
  return {
    contractVersion:"bono.physical-content-reuse.v1",
    bySha,
    separateLegalRecords,
    hashProvesCaseRelation:false,
    hashChangesDocumentOwnership:false
  };
}

module.exports={
  CONTRACT_VERSION,
  CASE_IDENTITY_STATES,
  LINK_STATES,
  RELATION_TYPES,
  caseIdentityKey,
  documentSourceKey,
  normalizeCaseNode,
  normalizeLink,
  normalizeDocument,
  linkPolicy,
  validateLinkedLegalCaseGraph,
  projectDocumentView,
  buildPhysicalReuseIndex
};
