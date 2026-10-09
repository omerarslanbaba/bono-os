"use strict";

const path=require("path");
const linkedFixture=require(path.join(__dirname,"fixtures","uyap_linked_legal_case_graph.json"));
const fixture=require(path.join(__dirname,"fixtures","uyap_general_cbs_linked_adapter.json"));
const linked=require("../contracts/uyap_linked_legal_case_contract");
const adapter=require("../contracts/uyap_cbs_linked_document_adapter");

function must(ok,msg){if(!ok)throw new Error(msg)}
const results=[];
function pass(name,detail={}){results.push({name,status:"pass",...detail})}

must(fixture.fixtureMetadata?.synthetic===true,"adapter fixture must be synthetic");
must(fixture.fixtureMetadata?.liveUyapEvidence===false,"adapter fixture must not claim live evidence");
must(fixture.fixtureMetadata?.containsRealUyapIdentifiers===false,"fixture must declare no real UYAP identifiers");
pass("fixture_contains_no_real_uyap_evidence");

const graph=linked.validateLinkedLegalCaseGraph(linkedFixture);
must(graph.valid===true,"linked graph fixture must remain valid");

const adapted=adapter.adaptGeneralCbsParserOutput({
  parserOutput:fixture.parserOutput,
  linkedCaseGraph:graph,
  displayCaseNodeId:fixture.displayCaseNodeId,
  viewPathsBySourceCaseNodeId:fixture.viewPathsBySourceCaseNodeId
});
must(adapted.valid===true,"adapter result should validate: "+JSON.stringify(adapted.errors));
must(adapted.contractVersion==="bono.cbs-linked-document-adapter.v1","adapter contract version mismatch");
pass("general_cbs_parser_output_adapts_without_runtime_dependencies");

const mixed=adapted.groups.find(g=>g.title==="KARISIK GORUNUM");
must(mixed&&mixed.mixedSources===true,"mixed group sources not detected");
must(mixed.sourceDosyaIds.length===2,"mixed group should preserve two explicit source dosyaIds");
must(mixed.mayCreateSingleSourceCase===false&&mixed.automaticSingleSourceRejected===true,"mixed group became one source case");
pass("mixed_group_never_creates_single_source_case");

for(const g of adapted.groups){
  must(g.groupTitleProvesSource===false,"group title became source proof");
  must(g.groupTitleProvesRelationType===false,"group title became relation type proof");
  must(g.groupTitleProvesVerifiedLink===false,"group title became verified link proof");
}
must(adapted.safety.groupTitleContextOnly===true,"group title context-only invariant missing");
pass("group_title_is_display_context_only");

const main=adapted.occurrences.find(o=>o.occurrenceId==="tumEvraklar:g0:m0");
const attachment=adapted.occurrences.find(o=>o.occurrenceId==="tumEvraklar:g0:m0:a0");
must(main.documentRole==="main"&&attachment.documentRole==="attachment","main/attachment roles collapsed");
must(attachment.attachment.parentMainEvrakId===main.source.evrakId,"attachment parent main evrak id lost");
must(attachment.attachment.anaEvrakId==="PARENT-OPAQUE-1","anaEvrakId not preserved");
must(attachment.source.uyapDosyaId===null&&attachment.source.state==="unknown","missing attachment source was inherited from parent");
must(attachment.attachment.missingSourceNotInherited===true,"missing attachment source inheritance flag wrong");
must(attachment.attachment.anaEvrakIdSemantics==="preserved_not_inferred","anaEvrakId semantics were guessed");
pass("main_attachment_source_and_parent_concepts_remain_separate");

must(main.observedView.visibleFromCaseNodeId==="cbs-new","display case missing from observed view");
must(main.source.caseNodeId==="cbs-new","main source case wrong");
must(main.observedView.provesLegalRelationship===false&&main.observedView.changesOwnership===false,"parser visibility became legal proof");
pass("source_case_and_display_case_are_separate_concepts");

const sharedRecords=adapted.legalDocuments.filter(d=>d.source.evrakId==="EVRAK-SHARED-ID");
must(sharedRecords.length===2,"same evrakId from different dosyaIds was incorrectly deduplicated");
must(new Set(sharedRecords.map(d=>d.source.uyapDosyaId)).size===2,"shared evrakId sources collapsed");
must(adapted.identityDiagnostics.evrakIdCollisions.some(x=>x.evrakId==="EVRAK-SHARED-ID"&&x.distinctSourceCount===2),"cross-source evrakId collision not diagnosed");
pass("same_evrak_id_across_sources_stays_distinct");

const old2=adapted.legalDocuments.find(d=>d.legalDocumentKey===JSON.stringify(["FIXTURE-CBS-OLD-DOSYA","EVRAK-OLD-2"]));
must(old2&&old2.occurrenceIds.length===3,"same source document repeated across groups/son20 should preserve occurrences");
must(old2.occurrenceIds.filter(x=>x.startsWith("tumEvraklar:")).length===2,"same source document across two dynamic groups lost an occurrence");
must(old2.occurrenceIds.some(x=>x.startsWith("son20Evrak:")),"son20 alternative view occurrence provenance lost");
pass("same_source_document_can_have_multiple_view_occurrences");

const oldOccurrence=adapted.occurrences.find(o=>
  o.source.uyapDosyaId==="FIXTURE-CBS-OLD-DOSYA"&&o.source.evrakId==="EVRAK-OLD-2"&&o.surface==="tumEvraklar"
);
must(oldOccurrence.linkedProjection.state==="verified"&&oldOccurrence.linkedProjection.visible===true,"verified old-new relation not projected");
must(oldOccurrence.linkedProjection.mayAutoInclude===true&&oldOccurrence.autoDownloadEligible===true,"verified relation not eligible for automatic scope");
must(oldOccurrence.source.caseNodeId==="cbs-old"&&oldOccurrence.observedView.visibleFromCaseNodeId==="cbs-new","verified projection changed source/display identity");
pass("verified_relation_supports_multi_case_view_without_rebinding");

const userSelected=adapted.occurrences.find(o=>o.source.uyapDosyaId==="FIXTURE-TALIMAT-A-DOSYA");
must(userSelected.linkedProjection.state==="user_selected_unverified","user-selected link state lost");
must(userSelected.linkedProjection.visible===true,"user-selected linked document should remain visible by explicit choice");
must(userSelected.linkedProjection.mayAutoInclude===false&&userSelected.autoDownloadEligible===false,"user-selected unverified relation entered automatic scope");
pass("user_selected_unverified_relation_is_never_auto_downloaded");

const unknown=adapted.occurrences.find(o=>o.source.evrakId==="EVRAK-UNKNOWN-SOURCE");
must(unknown.source.state==="unknown"&&unknown.source.caseNodeId===null,"missing source dosyaId was guessed");
must(unknown.linkedProjection.visible===false&&unknown.linkedProjection.state==="unknown","unknown source did not fail closed");
must(unknown.autoDownloadEligible===false,"unknown source entered automatic scope");
must(unknown.legalDocumentKey.startsWith("unknown-source::"),"unknown source was assigned false legal identity");
pass("ambiguous_source_identity_remains_unknown_fail_closed");

const scope=adapter.buildAutomaticDownloadScope(adapted);
must(scope.userSelectedUnverifiedIncluded===false&&scope.unknownSourceIncluded===false,"automatic scope safety flags wrong");
must(!scope.documentKeys.includes(userSelected.legalDocumentKey),"user-selected unverified document entered automatic scope");
must(!scope.documentKeys.includes(unknown.legalDocumentKey),"unknown source entered automatic scope");
must(scope.documentKeys.includes(JSON.stringify(["FIXTURE-CBS-OLD-DOSYA","EVRAK-OLD-2"])),"verified related source missing from automatic scope");
pass("automatic_download_scope_contains_only_verified_source_and_verified_path");

const groupNameTrap=JSON.parse(JSON.stringify(fixture));
groupNameTrap.parserOutput.tumEvraklar={
  "TALIMAT DOSYASI - DOGRULANDI":[
    {dosyaId:"FIXTURE-CBS-OLD-DOSYA",evrakId:"EVRAK-GROUP-TRAP",ggEvrakId:"GG-TRAP"}
  ]
};
groupNameTrap.parserOutput.son20Evrak=[];
const trap=adapter.adaptGeneralCbsParserOutput({
  parserOutput:groupNameTrap.parserOutput,
  linkedCaseGraph:graph,
  displayCaseNodeId:"cbs-new",
  viewPathsBySourceCaseNodeId:{"cbs-old":["link-old-new"]}
});
must(trap.groups[0].groupTitleProvesRelationType===false&&trap.groups[0].groupTitleProvesVerifiedLink===false,"semantic group title upgraded relation");
must(trap.occurrences[0].linkedProjection.state==="verified","verified state should come from graph edge, not label");
pass("group_name_never_derives_relation_type_or_verification");

const noPath=adapter.adaptGeneralCbsParserOutput({
  parserOutput:{
    tumEvraklar:{
      "GORUNUR AMA BAGLANTI KANITI YOK":[
        {dosyaId:"FIXTURE-CBS-OLD-DOSYA",evrakId:"EVRAK-NO-PATH",ggEvrakId:"GG-NO-PATH"}
      ]
    }
  },
  linkedCaseGraph:graph,
  displayCaseNodeId:"cbs-new",
  viewPathsBySourceCaseNodeId:{}
});
must(noPath.occurrences[0].observedView.visible===true,"parser display occurrence should be retained");
must(noPath.occurrences[0].linkedProjection.state==="unknown"&&noPath.occurrences[0].autoDownloadEligible===false,"display visibility was promoted to legal relationship");
pass("parser_visibility_does_not_prove_linked_case_relationship");

const attachmentConflict=adapter.adaptGeneralCbsParserOutput({
  parserOutput:{
    tumEvraklar:{
      "EK KAYNAK CATISMASI":[
        {
          dosyaId:"FIXTURE-CBS-NEW-DOSYA",evrakId:"MAIN-CONFLICT",ggEvrakId:"GG-CONFLICT",
          ekEvrakListesi:[{dosyaId:"FIXTURE-CBS-OLD-DOSYA",anaEvrakId:"PARENT-X",evrakId:"ATTACH-CONFLICT",sira:1,ekTuru:"fixture"}]
        }
      ]
    }
  },
  linkedCaseGraph:graph,
  displayCaseNodeId:"cbs-new"
});
const conflict=attachmentConflict.occurrences.find(o=>o.documentRole==="attachment");
must(conflict.source.state==="verified"&&conflict.source.uyapDosyaId==="FIXTURE-CBS-OLD-DOSYA","explicit attachment source was discarded");
must(conflict.attachment.parentSourceMatches===false,"parent/source mismatch diagnostic missing");
must(conflict.autoDownloadEligible===false,"attachment without explicit linked path entered auto scope");
pass("attachment_explicit_source_preserved_without_parent_inheritance");

console.log(JSON.stringify({
  ok:true,
  contractVersion:adapter.CONTRACT_VERSION,
  fixtureOnly:true,
  liveUyapEvidence:false,
  passed:results.length,
  results
},null,2));
