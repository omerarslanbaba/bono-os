"use strict";

const linked=require("./uyap_linked_legal_case_contract");

const CONTRACT_VERSION="bono.cbs-linked-document-adapter.v1";

function text(value){
  const s=String(value??"").trim();
  return s||null;
}

function sourceDocumentKey(dosyaId,evrakId){
  const d=text(dosyaId),e=text(evrakId);
  return d&&e?`${d}::${e}`:null;
}

function makeOccurrenceId(surface,groupIndex,mainIndex,attachmentIndex=null){
  const base=`${surface}:g${groupIndex}:m${mainIndex}`;
  return attachmentIndex==null?base:`${base}:a${attachmentIndex}`;
}

function groupSourceState(sourceIds,unknownCount){
  const unique=[...new Set(sourceIds.filter(Boolean))];
  if(unique.length===0)return "unknown";
  if(unique.length===1&&unknownCount===0)return "single_explicit_item_source";
  if(unique.length===1)return "mixed_known_and_unknown";
  return "mixed_explicit_item_sources";
}

function validateGraph(graphInput){
  return graphInput?.contractVersion===linked.CONTRACT_VERSION&&typeof graphInput?.valid==="boolean"
    ? graphInput
    : linked.validateLinkedLegalCaseGraph(graphInput||{});
}

function caseForDosyaId(graph,dosyaId){
  const id=text(dosyaId);
  if(!id)return null;
  return (graph.cases||[]).find(c=>c?.identity?.uyapDosyaId===id)||null;
}

function sourceIdentity(graph,dosyaId,evrakId){
  const id=text(dosyaId),docId=text(evrakId);
  if(!id||!docId){
    return {
      state:"unknown",
      caseNodeId:null,
      uyapDosyaId:id,
      evrakId:docId,
      reason:!id?"source_dosya_id_missing":"document_evrak_id_missing"
    };
  }
  const sourceCase=caseForDosyaId(graph,id);
  if(!sourceCase){
    return {
      state:"unknown",
      caseNodeId:null,
      uyapDosyaId:id,
      evrakId:docId,
      reason:"source_case_not_in_linked_graph"
    };
  }
  const verified=sourceCase.identity?.state==="verified";
  return {
    state:verified?"verified":"unverified",
    caseNodeId:sourceCase.nodeId,
    uyapDosyaId:id,
    evrakId:docId,
    unitName:sourceCase.identity?.unitName||null,
    fileNo:sourceCase.identity?.fileNo||null,
    reason:verified?null:"source_case_identity_not_verified"
  };
}

function projectionForOccurrence(graph,source,displayCaseNodeId,viewPathsBySourceCaseNodeId={}){
  const display=text(displayCaseNodeId);
  const observedView={
    visible:true,
    visibleFromCaseNodeId:display,
    basis:"parser_display_occurrence",
    provesLegalRelationship:false,
    changesOwnership:false
  };

  if(!display||!(graph.cases||[]).some(c=>c.nodeId===display)){
    return {
      observedView,
      linkedProjection:{
        visible:false,state:"unknown",mayAutoInclude:false,
        reason:"display_case_missing",changesOwnership:false
      }
    };
  }
  if(source.state!=="verified"||!source.caseNodeId){
    return {
      observedView,
      linkedProjection:{
        visible:false,state:"unknown",mayAutoInclude:false,
        reason:source.reason||"source_identity_not_verified",changesOwnership:false
      }
    };
  }

  const sourceCase=(graph.cases||[]).find(c=>c.nodeId===source.caseNodeId);
  const doc={
    documentKey:sourceDocumentKey(source.uyapDosyaId,source.evrakId),
    source:{
      caseNodeId:source.caseNodeId,
      uyapDosyaId:source.uyapDosyaId,
      unitName:sourceCase?.identity?.unitName||null,
      fileNo:sourceCase?.identity?.fileNo||null,
      evrakId:source.evrakId,
      ownershipState:"verified"
    }
  };
  const path=source.caseNodeId===display?[]:(viewPathsBySourceCaseNodeId[source.caseNodeId]||[]);
  const linkedProjection=linked.projectDocumentView(graph,doc,display,{viaLinkIds:path});
  return {observedView,linkedProjection};
}

function normalizeMainOccurrence({
  graph,item,surface,groupIndex,groupTitle,mainIndex,displayCaseNodeId,viewPathsBySourceCaseNodeId
}){
  const occurrenceId=makeOccurrenceId(surface,groupIndex,mainIndex);
  const source=sourceIdentity(graph,item?.dosyaId,item?.evrakId);
  const views=projectionForOccurrence(graph,source,displayCaseNodeId,viewPathsBySourceCaseNodeId);
  const legalKey=sourceDocumentKey(source.uyapDosyaId,source.evrakId)||`unknown-source::${occurrenceId}`;
  return {
    occurrenceId,
    surface,
    displayGroup:{
      key:`${surface}:g${groupIndex}`,
      title:text(groupTitle),
      contextOnly:true,
      provesSource:false,
      provesRelationType:false,
      provesVerifiedLink:false
    },
    documentRole:"main",
    legalDocumentKey:legalKey,
    source:{
      ...source,
      ggEvrakId:text(item?.ggEvrakId),
      basis:text(item?.dosyaId)?"main_item_explicit_dosya_id":"unknown"
    },
    attachment:null,
    ...views,
    autoDownloadEligible:source.state==="verified"&&views.linkedProjection?.mayAutoInclude===true
  };
}

function normalizeAttachmentOccurrence({
  graph,item,parentItem,surface,groupIndex,groupTitle,mainIndex,attachmentIndex,
  displayCaseNodeId,viewPathsBySourceCaseNodeId
}){
  const occurrenceId=makeOccurrenceId(surface,groupIndex,mainIndex,attachmentIndex);
  const ownDosyaId=text(item?.dosyaId);
  const parentDosyaId=text(parentItem?.dosyaId);
  const sourceConflict=!!(ownDosyaId&&parentDosyaId&&ownDosyaId!==parentDosyaId);
  const effectiveDosyaId=sourceConflict?null:(ownDosyaId||parentDosyaId);
  const source=sourceIdentity(graph,effectiveDosyaId,item?.evrakId);
  if(sourceConflict){
    source.state="unknown";
    source.caseNodeId=null;
    source.reason="attachment_source_conflicts_with_parent_source";
  }
  const views=projectionForOccurrence(graph,source,displayCaseNodeId,viewPathsBySourceCaseNodeId);
  const legalKey=sourceDocumentKey(source.uyapDosyaId,source.evrakId)||`unknown-source::${occurrenceId}`;
  return {
    occurrenceId,
    surface,
    displayGroup:{
      key:`${surface}:g${groupIndex}`,
      title:text(groupTitle),
      contextOnly:true,
      provesSource:false,
      provesRelationType:false,
      provesVerifiedLink:false
    },
    documentRole:"attachment",
    legalDocumentKey:legalKey,
    source:{
      ...source,
      basis:sourceConflict
        ?"conflict"
        :ownDosyaId
          ?"attachment_item_explicit_dosya_id"
          :parentDosyaId
            ?"parent_main_explicit_dosya_id"
            :"unknown"
    },
    attachment:{
      anaEvrakId:text(item?.anaEvrakId),
      parentMainEvrakId:text(parentItem?.evrakId),
      parentMainGgEvrakId:text(parentItem?.ggEvrakId),
      sira:item?.sira??null,
      ekTuru:text(item?.ekTuru),
      parentBasis:"nested_under_main",
      anaEvrakIdSemantics:"preserved_not_inferred"
    },
    ...views,
    autoDownloadEligible:source.state==="verified"&&views.linkedProjection?.mayAutoInclude===true
  };
}

function collectTumEvraklar(graph,tumEvraklar,ctx){
  const groups=[],occurrences=[];
  if(tumEvraklar==null)return {recognized:true,groups,occurrences};
  if(typeof tumEvraklar!=="object"||Array.isArray(tumEvraklar)){
    return {recognized:false,reason:"tumEvraklar_dynamic_group_object_required",groups,occurrences};
  }
  let groupIndex=0;
  for(const [title,items] of Object.entries(tumEvraklar)){
    const groupOccurrences=[];
    if(Array.isArray(items)){
      items.forEach((item,mainIndex)=>{
        const main=normalizeMainOccurrence({
          graph,item,surface:"tumEvraklar",groupIndex,groupTitle:title,mainIndex,...ctx
        });
        occurrences.push(main);groupOccurrences.push(main);
        const attachments=Array.isArray(item?.ekEvrakListesi)?item.ekEvrakListesi:[];
        attachments.forEach((attachment,attachmentIndex)=>{
          const child=normalizeAttachmentOccurrence({
            graph,item:attachment,parentItem:item,surface:"tumEvraklar",
            groupIndex,groupTitle:title,mainIndex,attachmentIndex,...ctx
          });
          occurrences.push(child);groupOccurrences.push(child);
        });
      });
    }
    const sourceIds=groupOccurrences.map(o=>o.source?.uyapDosyaId).filter(Boolean);
    const unknownCount=groupOccurrences.filter(o=>!o.source?.uyapDosyaId||o.source?.state==="unknown").length;
    const sourceState=groupSourceState(sourceIds,unknownCount);
    groups.push({
      groupKey:`tumEvraklar:g${groupIndex}`,
      title:text(title),
      contextOnly:true,
      occurrenceCount:groupOccurrences.length,
      sourceDosyaIds:[...new Set(sourceIds)],
      sourceState,
      mixedSources:sourceState==="mixed_explicit_item_sources"||sourceState==="mixed_known_and_unknown",
      mayCreateSingleSourceCase:false,
      groupTitleProvesSource:false,
      groupTitleProvesRelationType:false,
      groupTitleProvesVerifiedLink:false,
      automaticSingleSourceRejected:sourceState!=="single_explicit_item_source"
    });
    groupIndex++;
  }
  return {recognized:true,groups,occurrences};
}

function collectSon20(graph,son20Evrak,ctx){
  const occurrences=[];
  if(son20Evrak==null)return {recognized:true,occurrences};
  if(!Array.isArray(son20Evrak))return {recognized:false,reason:"son20Evrak_array_required",occurrences};
  son20Evrak.forEach((item,mainIndex)=>{
    occurrences.push(normalizeMainOccurrence({
      graph,item,surface:"son20Evrak",groupIndex:0,groupTitle:null,mainIndex,...ctx
    }));
  });
  return {recognized:true,occurrences};
}

function buildLegalDocuments(occurrences){
  const map=new Map();
  const sameEvrakSources=new Map();
  for(const occurrence of occurrences){
    const evrakId=occurrence.source?.evrakId;
    const dosyaId=occurrence.source?.uyapDosyaId;
    if(evrakId&&dosyaId){
      if(!sameEvrakSources.has(evrakId))sameEvrakSources.set(evrakId,new Set());
      sameEvrakSources.get(evrakId).add(dosyaId);
    }
    const key=occurrence.legalDocumentKey;
    if(!map.has(key)){
      map.set(key,{
        legalDocumentKey:key,
        source:{
          state:occurrence.source?.state||"unknown",
          caseNodeId:occurrence.source?.caseNodeId||null,
          uyapDosyaId:dosyaId||null,
          evrakId:evrakId||null
        },
        roles:[],
        occurrenceIds:[],
        autoDownloadEligible:false
      });
    }
    const record=map.get(key);
    if(!record.roles.includes(occurrence.documentRole))record.roles.push(occurrence.documentRole);
    record.occurrenceIds.push(occurrence.occurrenceId);
    record.autoDownloadEligible=record.autoDownloadEligible||occurrence.autoDownloadEligible===true;
  }
  const evrakIdCollisions=[];
  for(const [evrakId,sources] of sameEvrakSources){
    if(sources.size>1)evrakIdCollisions.push({
      evrakId,
      distinctSourceCount:sources.size,
      decision:"keep_separate_by_source_dosya_id_plus_evrak_id"
    });
  }
  return {
    legalDocuments:[...map.values()],
    evrakIdCollisions,
    dedupKey:"source_dosya_id_plus_evrak_id",
    groupTitlePartOfLegalIdentity:false,
    evrakIdAloneIsUnique:false
  };
}

function adaptGeneralCbsParserOutput({
  parserOutput={},
  linkedCaseGraph={},
  displayCaseNodeId=null,
  viewPathsBySourceCaseNodeId={}
}={}){
  const graph=validateGraph(linkedCaseGraph);
  const ctx={displayCaseNodeId,viewPathsBySourceCaseNodeId};
  const grouped=collectTumEvraklar(graph,parserOutput?.tumEvraklar,ctx);
  const recent=collectSon20(graph,parserOutput?.son20Evrak,ctx);
  const occurrences=[...grouped.occurrences,...recent.occurrences];
  const legal=buildLegalDocuments(occurrences);
  const errors=[];
  if(!graph.valid)errors.push({code:"linked_case_graph_invalid"});
  if(!grouped.recognized)errors.push({code:grouped.reason});
  if(!recent.recognized)errors.push({code:recent.reason});
  if(!text(displayCaseNodeId)||!(graph.cases||[]).some(c=>c.nodeId===text(displayCaseNodeId))){
    errors.push({code:"display_case_missing"});
  }
  return {
    contractVersion:CONTRACT_VERSION,
    valid:errors.length===0,
    errors,
    displayCaseNodeId:text(displayCaseNodeId),
    groups:grouped.groups,
    occurrences,
    legalDocuments:legal.legalDocuments,
    identityDiagnostics:{
      evrakIdCollisions:legal.evrakIdCollisions,
      dedupKey:legal.dedupKey,
      groupTitlePartOfLegalIdentity:false,
      evrakIdAloneIsUnique:false
    },
    safety:{
      groupTitleContextOnly:true,
      groupTitleProvesSource:false,
      groupTitleProvesRelationType:false,
      groupTitleProvesVerifiedLink:false,
      parserVisibilityProvesLegalRelationship:false,
      autoCaseCreationFromGroupAllowed:false,
      userSelectedUnverifiedAutoDownloadAllowed:false
    }
  };
}

function buildAutomaticDownloadScope(adapted){
  const documents=(adapted?.legalDocuments||[]).filter(d=>
    d?.source?.state==="verified"&&d?.autoDownloadEligible===true
  );
  return {
    contractVersion:"bono.cbs-linked-download-scope.v1",
    automatic:true,
    documentKeys:documents.map(d=>d.legalDocumentKey),
    excludedDocumentKeys:(adapted?.legalDocuments||[])
      .filter(d=>!documents.includes(d))
      .map(d=>d.legalDocumentKey),
    userSelectedUnverifiedIncluded:false,
    unknownSourceIncluded:false
  };
}

module.exports={
  CONTRACT_VERSION,
  sourceDocumentKey,
  adaptGeneralCbsParserOutput,
  buildAutomaticDownloadScope
};
