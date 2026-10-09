"use strict";

const path=require("path");
const fixture=require(path.join(__dirname,"fixtures","uyap_cbs_document_list_linked_acceptance.json"));
const linked=require("../contracts/uyap_linked_legal_case_contract");
const compat=require("../contracts/uyap_cbs_document_list_compat");

function must(ok,msg){if(!ok)throw new Error(msg)}
const results=[];
function pass(name,detail={}){results.push({name,status:"pass",...detail})}

must(fixture.fixtureMetadata?.synthetic===true,"fixture must be synthetic");
must(fixture.fixtureMetadata?.liveUyapEvidence===false,"fixture must not claim live evidence");
must(fixture.fixtureMetadata?.containsRealUyapIdentifiers===false,"fixture must contain no real UYAP identifiers");
pass("fixture_declares_synthetic_only");

const graph=linked.validateLinkedLegalCaseGraph(fixture.linkedCaseGraph);
must(graph.valid===true,"linked graph must validate: "+JSON.stringify(graph.errors));
pass("linked_graph_valid");

const adapted=compat.adaptCbsDocumentListOutput({
  parsed:fixture.parsed,
  linkedCaseGraph:graph,
  displayCaseNodeId:fixture.displayCaseNodeId,
  viewPathsBySourceCaseNodeId:fixture.viewPathsBySourceCaseNodeId
});
must(adapted.valid===true,"compat adapter should validate: "+JSON.stringify(adapted.errors));
must(adapted.sourceContractVersion==="bono.cbs-document-list.v1","source contract mismatch");
must(adapted.linkedAdapterContract==="bono.cbs-linked-document-adapter.v1","target adapter contract mismatch");
pass("pr22_output_shape_is_accepted_by_pr24_contract");

const main=adapted.occurrences.find(x=>x.occurrenceId==="occurrence:0");
must(main.source.uyapDosyaId==="DISPLAY-A","dosyaId changed");
must(main.source.evrakId==="SAME-EVRAK","evrakId changed");
must(main.metadata.ggEvrakId==="GG-DISPLAY","ggEvrakId changed");
must(main.metadata.dosyaId==="DISPLAY-A"&&main.metadata.evrakId==="SAME-EVRAK","main metadata identity changed");
pass("main_identity_fields_transfer_losslessly");

const attachment=adapted.occurrences.find(x=>x.occurrenceId==="occurrence:4");
must(attachment.documentRole==="attachment","attachment role lost");
must(attachment.source.uyapDosyaId==="OLD-A"&&attachment.source.evrakId==="ATTACH-1","attachment source IDs changed");
must(attachment.metadata.anaEvrakId===17&&typeof attachment.metadata.anaEvrakId==="number","anaEvrakId type changed");
must(attachment.metadata.sira===3&&typeof attachment.metadata.sira==="number","sira type changed");
must(attachment.metadata.ekTuru==="SYNTH-EK","ekTuru changed");
must(attachment.attachment.parentReference==="occurrence:2","parent occurrence lost");
must(attachment.attachment.sourceInheritedFromParent===false,"attachment source inheritance enabled");
pass("attachment_fields_transfer_losslessly");

const missingAttachment=adapted.occurrences.find(x=>x.occurrenceId==="occurrence:5");
must(missingAttachment.source.state==="unknown"&&missingAttachment.source.uyapDosyaId===null,"missing attachment source was invented");
must(missingAttachment.attachment.sourceInheritedFromParent===false,"missing source inherited parent dosyaId");
must(missingAttachment.metadata.anaEvrakId==="PARENT-UNKNOWN","string anaEvrakId changed");
must(missingAttachment.metadata.sira==="04"&&typeof missingAttachment.metadata.sira==="string","string sira type changed");
must(missingAttachment.metadata.ekTuru==="SYNTH-EK-NO-SOURCE","missing-source ekTuru changed");
pass("missing_attachment_source_remains_unknown_fail_closed");

const old=adapted.occurrences.find(x=>x.occurrenceId==="occurrence:1");
must(old.source.caseNodeId==="old-cbs","source case wrong");
must(old.observedView.visibleFromCaseNodeId==="display-cbs","display case wrong");
must(old.observedView.visibleFromUyapDosyaId==="DISPLAY-A","visible-from dosyaId wrong");
must(old.source.uyapDosyaId==="OLD-A","source dosyaId rebound to display case");
must(old.observedView.changesOwnership===false,"display projection changed ownership");
pass("displayed_case_and_source_case_stay_separate");

const sameEvrak=adapted.legalDocuments.filter(x=>x.source.evrakId==="SAME-EVRAK");
must(sameEvrak.length===2,"same evrakId on different sources was merged");
must(new Set(sameEvrak.map(x=>x.source.uyapDosyaId)).size===2,"different source dosyaIds collapsed");
must(adapted.identityDiagnostics.evrakIdCollisions.some(x=>x.evrakId==="SAME-EVRAK"&&x.distinctSourceCount===2),"same-evrak cross-source collision not diagnosed");
pass("same_evrak_id_different_sources_remain_distinct");

const repeat=adapted.legalDocuments.find(x=>x.source.uyapDosyaId==="OLD-A"&&x.source.evrakId==="REPEAT-EVRAK");
must(repeat&&repeat.occurrenceIds.length===2,"same source document across views was duplicated");
must(repeat.occurrenceIds.includes("occurrence:2")&&repeat.occurrenceIds.includes("occurrence:3"),"full/recent occurrences not preserved");
pass("same_source_document_across_group_and_son20_is_one_legal_identity");

must(main.linkedProjection.state==="source_case"&&main.linkedProjection.mayAutoInclude===true,"verified target source state lost");
must(old.linkedProjection.state==="verified"&&old.linkedProjection.mayAutoInclude===true,"verified linked state lost");
const selected=adapted.occurrences.find(x=>x.occurrenceId==="occurrence:6");
must(selected.linkedProjection.state==="user_selected_unverified","user-selected state upgraded/downgraded");
must(selected.linkedProjection.mayAutoInclude===false,"user-selected state entered automatic scope");
const unknown=adapted.occurrences.find(x=>x.occurrenceId==="occurrence:7");
must(unknown.linkedProjection.state==="unknown"&&unknown.linkedProjection.mayAutoInclude===false,"unknown state was upgraded");
pass("verified_user_selected_and_unknown_states_remain_distinct");

must(selected.parserGroup.relationshipState==="user_selected_unverified","parser group review selection lost");
must(selected.source.parserRelationshipState==="unknown","group selection changed occurrence ownership");
pass("parser_group_selection_never_upgrades_occurrence_ownership");

const groupOnly=JSON.parse(JSON.stringify(fixture));
groupOnly.linkedCaseGraph.links.find(x=>x.linkId==="display-to-instruction").state="unknown";
groupOnly.linkedCaseGraph.links.find(x=>x.linkId==="display-to-instruction").evidence={
  kind:"unknown",verified:false,userSelected:false,source:"synthetic-unknown"
};
const groupOnlyGraph=linked.validateLinkedLegalCaseGraph(groupOnly.linkedCaseGraph);
must(groupOnlyGraph.valid===true,"group-only graph invalid");
const groupOnlyAdapted=compat.adaptCbsDocumentListOutput({
  parsed:groupOnly.parsed,
  linkedCaseGraph:groupOnlyGraph,
  displayCaseNodeId:groupOnly.displayCaseNodeId,
  viewPathsBySourceCaseNodeId:groupOnly.viewPathsBySourceCaseNodeId
});
const groupOnlySelected=groupOnlyAdapted.occurrences.find(x=>x.occurrenceId==="occurrence:6");
must(groupOnlySelected.parserGroup.relationshipState==="user_selected_unverified","group selection missing");
must(groupOnlySelected.linkedProjection.state==="unknown","group label/selection incorrectly created linked relation");
pass("group_review_state_does_not_create_case_relationship");

must(adapted.safety.metadataImportAllowed===false&&adapted.safety.downloadAllowed===false,"compat adapter granted runtime permission");
must(selected.runtimeDownloadAllowed===false&&selected.runtimeMetadataImportAllowed===false,"user-selected record granted runtime permission");
pass("compatibility_acceptance_does_not_enable_import_or_download");

const exactDisplay=' "SYNTH-DISPLAY::X" ';
const exactDoc='"SYNTH-DOC::Y" ';
const exactGg=' "GG EXACT" ';
const exactGraph=linked.validateLinkedLegalCaseGraph({
  processId:"exact-opaque",
  cases:[{
    nodeId:"exact-display",caseKind:"cbs",stage:"investigation",
    identity:{state:"verified",uyapDosyaId:exactDisplay,unitName:"Synthetic Exact Unit",fileNo:"SYNTH-EXACT-FILE"}
  }],
  links:[],
  documents:[]
});
must(exactGraph.valid===true,"exact opaque graph invalid");
const exactKey=JSON.stringify([exactDisplay,exactDoc]);
const exactParsed={
  contractVersion:"bono.cbs-document-list.v1",
  state:"parsed",parseState:"parsed",binding:{verified:true},
  completeness:{capture:true,structure:true},
  groups:[{reference:"group:0",view:"tumEvraklar",display:{fileNo:null,type:"unknown"},relationshipState:"unknown",sourceIds:[exactDisplay]}],
  occurrences:[{
    reference:"occurrence:0",view:"tumEvraklar",groupReference:"group:0",kind:"main",parentReference:null,
    metadata:{dosyaId:exactDisplay,evrakId:exactDoc,ggEvrakId:exactGg},
    source:{uyapDosyaId:exactDisplay,evrakId:exactDoc,ownershipState:"verified"},
    visibleFromUyapDosyaId:exactDisplay,sourceMatchesTarget:true,relationshipState:"verified",
    logicalKey:exactKey,permission:"unknown",reportedParentId:null,parentIdentityEquality:"unknown"
  }],
  logicalDocuments:[{key:exactKey,source:{uyapDosyaId:exactDisplay,evrakId:exactDoc},occurrenceReferences:["occurrence:0"]}]
};
const exact=compat.adaptCbsDocumentListOutput({parsed:exactParsed,linkedCaseGraph:exactGraph,displayCaseNodeId:"exact-display"});
must(exact.valid===true,"exact opaque adapter invalid: "+JSON.stringify(exact.errors));
must(exact.occurrences[0].source.uyapDosyaId===exactDisplay,"opaque dosyaId was trimmed/normalized");
must(exact.occurrences[0].source.evrakId===exactDoc,"opaque evrakId was trimmed/normalized");
must(exact.occurrences[0].metadata.ggEvrakId===exactGg,"opaque ggEvrakId was normalized");
pass("opaque_identifiers_preserve_exact_characters");

must(compat.exactLogicalKey("a::b","c")!==compat.exactLogicalKey("a","b::c"),"delimiter collision remained");
must(linked.documentSourceKey({uyapDosyaId:"a::b",evrakId:"c"})!==linked.documentSourceKey({uyapDosyaId:"a",evrakId:"b::c"}),"linked contract document key collision remained");
pass("logical_identity_key_is_collision_safe");

const metadataMismatch=JSON.parse(JSON.stringify(fixture));
metadataMismatch.parsed.occurrences[0].metadata.evrakId="DIFFERENT";
const metadataMismatchResult=compat.adaptCbsDocumentListOutput({
  parsed:metadataMismatch.parsed,
  linkedCaseGraph:metadataMismatch.linkedCaseGraph,
  displayCaseNodeId:metadataMismatch.displayCaseNodeId,
  viewPathsBySourceCaseNodeId:metadataMismatch.viewPathsBySourceCaseNodeId
});
must(metadataMismatchResult.valid===false&&metadataMismatchResult.errors.some(x=>x.code==="metadata_evrak_id_mismatch"),"metadata/source mismatch not rejected");
pass("metadata_source_identity_mismatch_rejected");

const logicalMismatch=JSON.parse(JSON.stringify(fixture));
logicalMismatch.parsed.occurrences[1].logicalKey='["WRONG","KEY"]';
const logicalMismatchResult=compat.adaptCbsDocumentListOutput({
  parsed:logicalMismatch.parsed,
  linkedCaseGraph:logicalMismatch.linkedCaseGraph,
  displayCaseNodeId:logicalMismatch.displayCaseNodeId,
  viewPathsBySourceCaseNodeId:logicalMismatch.viewPathsBySourceCaseNodeId
});
must(logicalMismatchResult.valid===false&&logicalMismatchResult.errors.some(x=>x.code==="logical_key_mismatch"),"logical key mismatch not rejected");
pass("parser_logical_identity_mismatch_rejected");

const wrongContract=JSON.parse(JSON.stringify(fixture));
wrongContract.parsed.contractVersion="bono.cbs-document-list.v0";
const wrongContractResult=compat.adaptCbsDocumentListOutput({
  parsed:wrongContract.parsed,
  linkedCaseGraph:wrongContract.linkedCaseGraph,
  displayCaseNodeId:wrongContract.displayCaseNodeId,
  viewPathsBySourceCaseNodeId:wrongContract.viewPathsBySourceCaseNodeId
});
must(wrongContractResult.valid===false&&wrongContractResult.errors.some(x=>x.code==="parser_contract_mismatch"),"wrong parser contract accepted");
pass("only_published_pr22_contract_is_accepted");

const wrongDisplay=JSON.parse(JSON.stringify(fixture));
wrongDisplay.parsed.occurrences.forEach(x=>x.visibleFromUyapDosyaId="OTHER-VIEW");
const wrongDisplayResult=compat.adaptCbsDocumentListOutput({
  parsed:wrongDisplay.parsed,
  linkedCaseGraph:wrongDisplay.linkedCaseGraph,
  displayCaseNodeId:wrongDisplay.displayCaseNodeId,
  viewPathsBySourceCaseNodeId:wrongDisplay.viewPathsBySourceCaseNodeId
});
must(wrongDisplayResult.displayCase.identityVerified===false&&wrongDisplayResult.displayCase.reason==="display_case_identity_mismatch","wrong visible/display identity not detected");
must(wrongDisplayResult.occurrences.every(x=>x.linkedProjection.mayAutoInclude===false),"display identity mismatch still auto-included documents");
pass("display_identity_mismatch_fails_closed");

const incomplete=JSON.parse(JSON.stringify(fixture));
incomplete.parsed.completeness.capture=false;
const incompleteResult=compat.adaptCbsDocumentListOutput({
  parsed:incomplete.parsed,
  linkedCaseGraph:incomplete.linkedCaseGraph,
  displayCaseNodeId:incomplete.displayCaseNodeId,
  viewPathsBySourceCaseNodeId:incomplete.viewPathsBySourceCaseNodeId
});
must(incompleteResult.parserEvidenceReady===false,"incomplete capture marked ready");
must(incompleteResult.occurrences.every(x=>x.linkedProjection.mayAutoInclude===false),"incomplete parser evidence still auto-included");
pass("incomplete_parser_evidence_fails_closed");

console.log(JSON.stringify({
  ok:true,
  contractVersion:compat.CONTRACT_VERSION,
  sourceContractVersion:compat.SOURCE_CONTRACT,
  fixtureOnly:true,
  liveUyapEvidence:false,
  passed:results.length,
  results
},null,2));
