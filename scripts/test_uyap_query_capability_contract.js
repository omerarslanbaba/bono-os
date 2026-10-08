"use strict";

const path=require("path");
const fixture=require(path.join(__dirname,"fixtures","uyap_query_capability_cases.json"));
const c=require("../bridge/uyap_query_capability_contract");

function must(ok,msg){if(!ok)throw new Error(msg)}
const results=[];
function pass(name,detail={}){results.push({name,status:"pass",...detail})}

must(fixture.fixtureMetadata?.synthetic===true,"fixture must declare synthetic=true");
must(fixture.fixtureMetadata?.liveUyapEvidence===false,"fixture suite must never claim live UYAP evidence");
pass("fixture_declares_no_live_evidence");

for(const scenario of fixture.scenarios){
  const out=c.diagnoseUyapCaseCapability(scenario.input);
  const e=scenario.expect||{};
  if("caseKind" in e)must(out.caseKind===e.caseKind,scenario.name+": caseKind");
  if("supportState" in e)must(out.supportState===e.supportState,scenario.name+": supportState "+out.supportState);
  if("availabilityState" in e)must(out.availabilityState===e.availabilityState,scenario.name+": availabilityState "+out.availabilityState);
  if("canDiscoverCase" in e)must(out.permissions.canDiscoverCase===e.canDiscoverCase,scenario.name+": canDiscoverCase");
  if("canQueryDocumentList" in e)must(out.permissions.canQueryDocumentList===e.canQueryDocumentList,scenario.name+": canQueryDocumentList");
  if("canBindDocuments" in e)must(out.permissions.canBindDocuments===e.canBindDocuments,scenario.name+": canBindDocuments");
  if("groupLabelMayProveOwnership" in e)must(out.permissions.groupLabelMayProveOwnership===e.groupLabelMayProveOwnership,scenario.name+": groupLabelMayProveOwnership");
  if("identityState" in e)must(out.identity.state===e.identityState,scenario.name+": identity state");
  if("identityLiveVerified" in e)must(out.identity.liveVerified===e.identityLiveVerified,scenario.name+": identity live verification");
  if("documentEvidenceVerified" in e)must(out.documentListEvidence.verified===e.documentEvidenceVerified,scenario.name+": document evidence");
  const blockerCode=out.primaryBlocker?.code||null;
  must(blockerCode===e.primaryBlocker,scenario.name+": primary blocker expected "+e.primaryBlocker+" got "+blockerCode);
  must(out.safeNextAction?.code===e.safeNextAction,scenario.name+": safe next action expected "+e.safeNextAction+" got "+out.safeNextAction?.code);
  must(typeof out.userStatus?.shortTr==="string"&&out.userStatus.shortTr.length>0,scenario.name+": Turkish status missing");
  pass(scenario.name,{blocker:blockerCode,next:out.safeNextAction.code});
}

must(c.classifyCaseKind({court:"Fixture Cumhuriyet Başsavcılığı"})==="cbs","CBS classification failed");
must(c.classifyCaseKind({court:"Fixture 1. İcra Dairesi"})==="enforcement","enforcement classification failed");
must(c.classifyCaseKind({caseType:"Talimat Dosyası"})==="instruction","instruction classification failed");
must(c.classifyCaseKind({court:"Fixture 2. Asliye Hukuk Mahkemesi"})==="court","court classification failed");
pass("case_kind_classifier_distinguishes_four_families");

must(c.isLiveEvidence({liveObserved:true,sourceType:"synthetic_fixture"})===false,"synthetic fixture cannot become live evidence");
must(c.isLiveEvidence({liveObserved:true})===false,"liveObserved flag alone cannot become live evidence");
must(c.isLiveEvidence({liveObserved:true,sourceType:"authorized_observation"})===true,"authorized live observation should be recognized");
pass("synthetic_success_is_not_live_evidence");

const docMissing=c.documentListEvidenceStatus({
  endpointObserved:true,responseObserved:false,responseShapeRecognized:false,
  method:"POST",path:"/list_dosya_evraklar.ajx",liveObserved:true,sourceType:"authorized_observation"
});
must(docMissing.verified===false&&docMissing.missing.includes("document_list_response_observation"),"response evidence gap not exposed");
pass("document_list_endpoint_and_response_evidence_are_separate");

const enforcementReady=c.diagnoseUyapCaseCapability({
  case:{caseKind:"enforcement"},operation:"document_list_query",
  caseIdentity:{state:"verified",verified:true,liveObserved:true,sourceType:"authorized_observation",identity:{uyapDosyaId:"OPAQUE-ICRA-LIVE"}},
  documentListEvidence:{endpointObserved:true,responseObserved:true,responseShapeRecognized:true,method:"POST",path:"/list_dosya_evraklar.ajx",liveObserved:true,sourceType:"authorized_observation",caseKinds:["enforcement"]},
  session:{state:"ready"}
});
must(enforcementReady.supportState==="supported"&&enforcementReady.permissions.canQueryDocumentList===true,"enforcement must become supported only with scoped live evidence");
pass("enforcement_support_requires_scoped_live_evidence");

const groupOnly=c.diagnoseUyapCaseCapability({
  case:{caseKind:"cbs"},operation:"bind_documents",
  caseIdentity:{state:"verified",verified:true,liveObserved:true,sourceType:"authorized_observation",identity:{uyapDosyaId:"OPAQUE-CBS-GROUP"}},
  documentListEvidence:{endpointObserved:true,responseObserved:true,responseShapeRecognized:true,method:"POST",path:"/list_dosya_evraklar.ajx",liveObserved:true,sourceType:"authorized_observation"},
  ownershipEvidence:{liveObserved:true,sourceType:"authorized_observation"},
  documentListResponse:{tumEvraklar:{"TALİMAT EVRAKLARI":[{evrakId:"E-GROUP-ONLY"}]}},
  session:{state:"ready"}
});
must(groupOnly.permissions.canBindDocuments===false,"group label must never authorize binding");
must(groupOnly.ownership.groupRule==="group_label_context_only","CBS group rule missing");
pass("group_label_never_proves_ownership");

const unknown=c.diagnoseUyapCaseCapability({case:{court:"Belirsiz Birim"},operation:"discover_case",session:{state:"ready"}});
must(unknown.caseKind==="unknown"&&unknown.supportState==="verification_pending","unknown case kind must fail closed to verification_pending");
pass("unknown_case_kind_fails_closed");

console.log(JSON.stringify({
  ok:true,
  contractVersion:c.CONTRACT_VERSION,
  fixtureOnly:true,
  liveUyapEvidence:false,
  passed:results.length,
  results
},null,2));
