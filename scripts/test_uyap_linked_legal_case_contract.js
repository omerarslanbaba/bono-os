"use strict";

const path=require("path");
const fixture=require(path.join(__dirname,"fixtures","uyap_linked_legal_case_graph.json"));
const c=require("../contracts/uyap_linked_legal_case_contract");

function must(ok,msg){if(!ok)throw new Error(msg)}
const results=[];
function pass(name,detail={}){results.push({name,status:"pass",...detail})}

must(fixture.fixtureMetadata?.synthetic===true,"fixture must be synthetic");
must(fixture.fixtureMetadata?.liveUyapEvidence===false,"fixture must not claim live UYAP evidence");
pass("fixture_is_explicitly_synthetic");

const graph=c.validateLinkedLegalCaseGraph(fixture);
must(graph.valid===true,"fixture graph should validate: "+JSON.stringify(graph.errors));
must(graph.contractVersion==="bono.linked-legal-cases.v1","contract version mismatch");
pass("fixture_graph_valid",{cases:graph.cases.length,links:graph.links.length,documents:graph.documents.length});

const oldCase=graph.cases.find(x=>x.nodeId==="cbs-old");
const newCase=graph.cases.find(x=>x.nodeId==="cbs-new");
must(oldCase.identity.uyapDosyaId!==newCase.identity.uyapDosyaId,"old/new CBS identities must stay distinct");
must(oldCase.identity.fileNo==="2025/100"&&newCase.identity.fileNo==="2026/200","old/new CBS file numbers changed");
pass("old_cbs_to_new_cbs_preserves_both_identities");

const oldNew=graph.links.find(x=>x.linkId==="link-old-new");
must(oldNew.relationType==="cbs_successor"&&oldNew.state==="verified","CBS successor relation wrong");
must(oldNew.policy.mayAutoTraverse===true&&oldNew.policy.mayDefaultIncludeRelatedDocuments===true,"verified relation policy wrong");
pass("verified_cbs_successor_is_distinct_link_not_identity_rewrite");

const prosecution=graph.links.find(x=>x.linkId==="link-new-court");
must(prosecution.relationType==="prosecution_to_court"&&prosecution.state==="verified","CBS to court relation missing");
must(graph.cases.find(x=>x.nodeId==="criminal-first").identity.uyapDosyaId==="FIXTURE-CEZA-FIRST-DOSYA","court identity changed");
pass("cbs_to_criminal_court_relation_preserves_court_identity");

const instruction=graph.links.find(x=>x.linkId==="link-new-instruction");
must(instruction.state==="user_selected_unverified","instruction relation should remain user-selected/unverified");
must(instruction.policy.mayAutoTraverse===false&&instruction.policy.requiresUserChoice===true,"user-selected relation became automatic");
pass("user_selected_instruction_link_stays_unverified");

const unknown=graph.links.find(x=>x.linkId==="link-new-instruction-unknown");
must(unknown.state==="unknown"&&unknown.policy.mayAutoTraverse===false,"unknown relation became traversable");
pass("unknown_relation_stays_unknown");

const appeal1=graph.links.find(x=>x.linkId==="link-court-appeal");
const appeal2=graph.links.find(x=>x.linkId==="link-appeal-cassation");
must(appeal1.relationType==="appeal_to"&&appeal2.relationType==="appeal_to","appeal chain relation type wrong");
must(graph.cases.find(x=>x.nodeId==="regional-appeal").identity.fileNo==="2027/10","appeal file number changed");
must(graph.cases.find(x=>x.nodeId==="cassation").identity.fileNo==="2028/20","cassation file number changed");
pass("first_instance_appeal_cassation_chain_preserves_stage_identities");

const oldDoc=graph.documents.find(x=>x.documentKey==="FIXTURE-CBS-OLD-DOSYA::EVRAK-OLD-1");
const oldToNew=c.projectDocumentView(graph,oldDoc,"cbs-new",{viaLinkIds:["link-old-new"]});
must(oldToNew.visible===true&&oldToNew.state==="verified"&&oldToNew.mayAutoInclude===true,"verified linked view failed");
must(oldToNew.source.caseNodeId==="cbs-old"&&oldToNew.source.uyapDosyaId==="FIXTURE-CBS-OLD-DOSYA","view rewrote document source");
must(oldToNew.visibleFromCaseNodeId==="cbs-new"&&oldToNew.changesOwnership===false,"view/source separation broken");
pass("document_source_and_visible_from_case_are_separate");

const oldToCourt=c.projectDocumentView(graph,oldDoc,"criminal-first",{viaLinkIds:["link-old-new","link-new-court"]});
must(oldToCourt.visible===true&&oldToCourt.state==="verified","verified multi-link projection failed");
must(oldToCourt.source.evrakId==="EVRAK-OLD-1","multi-link projection changed evrakId");
pass("verified_multi_case_path_can_show_source_document_without_rebinding");

const instructionDoc=graph.documents.find(x=>x.documentKey==="FIXTURE-TALIMAT-A-DOSYA::EVRAK-TALIMAT-1");
const instructionToMain=c.projectDocumentView(graph,instructionDoc,"cbs-new",{viaLinkIds:["link-new-instruction"]});
must(instructionToMain.visible===true&&instructionToMain.state==="user_selected_unverified","user-selected linked view should be explicitly unverified");
must(instructionToMain.mayAutoInclude===false,"user selection must not become default automatic inclusion");
must(instructionToMain.source.uyapDosyaId==="FIXTURE-TALIMAT-A-DOSYA","instruction document ownership changed");
pass("user_selected_view_is_visible_but_not_verified_or_auto_included");

const oldToUnknownInstruction=c.projectDocumentView(
  graph,oldDoc,"instruction-candidate",
  {viaLinkIds:["link-old-new","link-new-instruction-unknown"]}
);
must(oldToUnknownInstruction.visible===false&&oldToUnknownInstruction.state==="unknown","unknown path should fail closed");
must(oldToUnknownInstruction.source.uyapDosyaId==="FIXTURE-CBS-OLD-DOSYA","unknown path changed source");
pass("unknown_relation_path_fails_closed");

const courtDoc=graph.documents.find(x=>x.documentKey==="FIXTURE-CEZA-FIRST-DOSYA::EVRAK-COURT-9");
const courtToCassation=c.projectDocumentView(
  graph,courtDoc,"cassation",
  {viaLinkIds:["link-court-appeal","link-appeal-cassation"]}
);
must(courtToCassation.visible===true&&courtToCassation.state==="verified","appeal chain document projection failed");
must(courtToCassation.source.caseNodeId==="criminal-first","appeal chain projection changed source case");
pass("first_instance_document_can_be_viewed_through_verified_appeal_chain");

const reuse=c.buildPhysicalReuseIndex(graph.documents);
const sharedSha="a".repeat(64);
must(reuse.bySha[sharedSha].documentKeys.length===2,"same physical content should have two legal records");
must(reuse.bySha[sharedSha].physicalContentKey==="sha256:"+sharedSha,"physical content key mismatch");
must(reuse.separateLegalRecords.filter(x=>x.sha256===sharedSha).map(x=>x.sourceUyapDosyaId).sort().join("|")==="FIXTURE-CBS-OLD-DOSYA|FIXTURE-CEZA-FIRST-DOSYA","legal source records collapsed");
must(reuse.hashProvesCaseRelation===false&&reuse.hashChangesDocumentOwnership===false,"hash was promoted to legal proof");
pass("same_hash_reuses_physical_content_without_merging_legal_records");

const badSource=JSON.parse(JSON.stringify(fixture));
badSource.documents[0].source.uyapDosyaId="FIXTURE-WRONG-DOSYA";
const badSourceGraph=c.validateLinkedLegalCaseGraph(badSource);
must(badSourceGraph.valid===false&&badSourceGraph.errors.some(x=>x.code==="document.source_dosya_id_mismatch"),"source mismatch should reject");
pass("document_source_identity_mismatch_rejected");

const badSourceFields=JSON.parse(JSON.stringify(fixture));
badSourceFields.documents[0].source.unitName="Fixture Wrong Unit";
badSourceFields.documents[0].source.fileNo="2099/999";
const badSourceFieldsGraph=c.validateLinkedLegalCaseGraph(badSourceFields);
must(badSourceFieldsGraph.valid===false&&badSourceFieldsGraph.errors.some(x=>x.code==="document.source_unit_mismatch"),"source unit mismatch should reject");
must(badSourceFieldsGraph.errors.some(x=>x.code==="document.source_file_no_mismatch"),"source file number mismatch should reject");
pass("document_source_unit_and_file_number_mismatch_rejected");

const duplicateIdentity=JSON.parse(JSON.stringify(fixture));
duplicateIdentity.cases[1].identity.uyapDosyaId=duplicateIdentity.cases[0].identity.uyapDosyaId;
const duplicateIdentityGraph=c.validateLinkedLegalCaseGraph(duplicateIdentity);
must(duplicateIdentityGraph.valid===false&&duplicateIdentityGraph.errors.some(x=>x.code==="case.duplicate_uyap_dosya_id"),"same UYAP identity must not become two case nodes");
pass("duplicate_uyap_case_identity_rejected");

const verifiedToUnverified=JSON.parse(JSON.stringify(fixture));
verifiedToUnverified.links.find(x=>x.linkId==="link-new-instruction-unknown").state="verified";
verifiedToUnverified.links.find(x=>x.linkId==="link-new-instruction-unknown").evidence={
  kind:"fixture_explicit_reference",verified:true,userSelected:false,source:"synthetic-contract-test"
};
const verifiedToUnverifiedGraph=c.validateLinkedLegalCaseGraph(verifiedToUnverified);
must(verifiedToUnverifiedGraph.valid===false&&verifiedToUnverifiedGraph.errors.some(x=>x.code==="link.verified_requires_verified_case_identities"),"verified link must require verified endpoint identities");
pass("verified_link_cannot_hide_unverified_case_identity");

const selectedButVerified=JSON.parse(JSON.stringify(fixture));
selectedButVerified.links.find(x=>x.linkId==="link-new-instruction").evidence.verified=true;
const selectedButVerifiedGraph=c.validateLinkedLegalCaseGraph(selectedButVerified);
must(selectedButVerifiedGraph.valid===false&&selectedButVerifiedGraph.errors.some(x=>x.code==="link.user_selected_must_remain_unverified"),"user selection must not become verification evidence");
pass("user_selection_never_upgrades_relationship_verification");

const unsupportedRelation=JSON.parse(JSON.stringify(fixture));
unsupportedRelation.links[0].relationType="invented_relation";
const unsupportedRelationGraph=c.validateLinkedLegalCaseGraph(unsupportedRelation);
must(unsupportedRelationGraph.valid===false&&unsupportedRelationGraph.errors.some(x=>x.code==="link.unsupported_relation_type"),"unsupported relation type must fail closed");
pass("unsupported_relation_type_rejected");

const unsupportedState=JSON.parse(JSON.stringify(fixture));
unsupportedState.links[0].state="confirmed-ish";
const unsupportedStateGraph=c.validateLinkedLegalCaseGraph(unsupportedState);
must(unsupportedStateGraph.valid===false&&unsupportedStateGraph.errors.some(x=>x.code==="link.unsupported_state"),"unsupported link state must fail closed");
pass("unsupported_link_state_rejected");

const badIntegrity=JSON.parse(JSON.stringify(fixture));
badIntegrity.documents[0].physicalContent.sha256="not-a-sha";
const badIntegrityGraph=c.validateLinkedLegalCaseGraph(badIntegrity);
must(badIntegrityGraph.valid===false&&badIntegrityGraph.errors.some(x=>x.code==="document.verified_integrity_requires_sha256"),"verified physical reuse needs real SHA-256 shape");
pass("physical_reuse_requires_verified_sha256_shape");

console.log(JSON.stringify({
  ok:true,
  contractVersion:c.CONTRACT_VERSION,
  fixtureOnly:true,
  liveUyapEvidence:false,
  passed:results.length,
  results
},null,2));
