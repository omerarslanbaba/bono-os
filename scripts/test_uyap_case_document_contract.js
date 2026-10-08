"use strict";

const c=require("../bridge/uyap_case_document_contract");

function must(ok,msg){if(!ok)throw new Error(msg)}
const results=[];
function pass(name,detail={}){results.push({name,status:"pass",...detail})}

// Case 93 is a product/test scenario supplied to the project.
// No real UYAP payload for Eskişehir CBS 2026/51832 is committed in this repo.
// Opaque IDs below are synthetic and must never be treated as live evidence.
const case93Target={
  caseId:93,
  court:"Eskişehir Cumhuriyet Başsavcılığı",
  fileNo:"2026/51832",
  uyapDosyaId:"FIXTURE-CASE93-DOSYA-ID"
};
const case93Observed={
  birimAdi:"Eskişehir Cumhuriyet Başsavcılığı",
  dosyaNo:"2026/51832",
  dosyaId:"FIXTURE-CASE93-DOSYA-ID"
};
const identity=c.verifyCaseIdentity(case93Target,case93Observed,{
  source:"case93_fixture_reference",
  liveObserved:false
});
must(identity.verified===true,"case93 exact fixture identity should verify");
must(identity.liveObserved===false,"fixture must not claim live observation");
pass("case93_exact_fixture_identity",{liveObserved:identity.liveObserved});

const wrongNo=c.verifyCaseIdentity(case93Target,{...case93Observed,dosyaNo:"2026/51833"},{source:"fixture",liveObserved:false});
must(wrongNo.state==="mismatch"&&wrongNo.verified===false,"wrong case number must fail");
pass("case_number_mismatch_rejected");

const wrongCourt=c.verifyCaseIdentity(case93Target,{...case93Observed,birimAdi:"Eskişehir 1. Sulh Ceza Hakimliği"},{source:"fixture",liveObserved:false});
must(wrongCourt.state==="mismatch","wrong court must fail");
pass("court_mismatch_rejected");

const grouped={
  tumEvraklar:{
    "SORUŞTURMA EVRAKLARI":[
      {evrakId:"E-OWN-1",dosyaId:"FIXTURE-CASE93-DOSYA-ID",tur:"İfade Tutanağı",onaylandigiTarih:"08/10/2026"},
      {evrakId:"E-FOREIGN",dosyaId:"FIXTURE-OTHER-CASE",tur:"Beyan",onaylandigiTarih:"08/10/2026"}
    ],
    "TALİMAT EVRAKLARI":[
      {evrakId:"E-TALIMAT",dosyaId:"FIXTURE-TALIMAT-CASE",tur:"Talimat Sonuç Yazısı"},
      {evrakId:"E-NO-CASE-ID",tur:"Tutanak"}
    ]
  }
};
const ownership=c.validateDocumentListOwnership(identity.identity,grouped);
must(ownership.state==="partial"&&ownership.failClosed===true,"mixed grouped response must fail closed");
must(ownership.counts.owned===1&&ownership.counts.foreign===2&&ownership.counts.unverified===1,"ownership counts wrong");
must(ownership.owned[0].evidence.ownershipKey==="FIXTURE-CASE93-DOSYA-ID::E-OWN-1","owned key wrong");
must(ownership.foreign.every(x=>x.evidence.bind===false),"foreign docs must not bind");
must(ownership.unverified.every(x=>x.evidence.bind===false),"unverified docs must not bind");
pass("mixed_cbs_talimat_response_fails_closed",{counts:ownership.counts});

const clean=c.validateDocumentListOwnership(identity.identity,{
  tumEvraklar:[
    {evrakId:"E-1",dosyaId:"FIXTURE-CASE93-DOSYA-ID",tur:"İfade Tutanağı"},
    {evrakId:"E-2",dosyaId:"FIXTURE-CASE93-DOSYA-ID",tur:"Karar"}
  ]
});
must(clean.state==="verified"&&clean.accepted===true&&clean.counts.owned===2,"clean exact list should verify");
pass("exact_document_list_ownership_verified",{count:clean.counts.owned});

const missingTarget=c.validateDocumentListOwnership({},{
  tumEvraklar:[{evrakId:"E-1",dosyaId:"FIXTURE-CASE93-DOSYA-ID"}]
});
must(missingTarget.state==="rejected"&&missingTarget.unverified[0].evidence.reason==="target_case_id_missing","missing target dosyaId must reject");
pass("missing_target_case_id_rejected");

const unknownShape=c.validateDocumentListOwnership(identity.identity,{evraklar:[{evrakId:"E-1",dosyaId:"FIXTURE-CASE93-DOSYA-ID"}]});
must(unknownShape.state==="rejected"&&unknownShape.reason==="unsupported_document_list_shape","unknown list shape must fail closed");
pass("unknown_document_list_shape_rejected");

const remoteVerified=c.verifyPersistedRemoteOwnership(identity.identity,{
  remote_document_id:"E-OWN-1",
  metadata_json:JSON.stringify({evrakId:"E-OWN-1",dosyaId:"FIXTURE-CASE93-DOSYA-ID",__uyapGroup:"SORUŞTURMA EVRAKLARI"})
});
must(remoteVerified.verified===true&&remoteVerified.bind===true,"persisted owned metadata should verify");
pass("persisted_remote_metadata_verified");

const remoteForeign=c.verifyPersistedRemoteOwnership(identity.identity,{
  remote_document_id:"E-FOREIGN",
  metadata_json:JSON.stringify({evrakId:"E-FOREIGN",dosyaId:"FIXTURE-OTHER-CASE"})
});
must(remoteForeign.verified===false&&remoteForeign.reason==="document_belongs_to_different_case","foreign persisted metadata must reject");
pass("persisted_foreign_metadata_rejected");

const remoteIdMismatch=c.verifyPersistedRemoteOwnership(identity.identity,{
  remote_document_id:"E-STORED",
  metadata_json:JSON.stringify({evrakId:"E-META",dosyaId:"FIXTURE-CASE93-DOSYA-ID"})
});
must(remoteIdMismatch.state==="mismatch"&&remoteIdMismatch.bind===false,"stored/meta remote id mismatch must reject");
pass("stored_remote_id_mismatch_rejected");

const lifecycleNoList=c.buildSingleCaseLifecycle({caseIdentity:identity});
must(lifecycleNoList.caseDiscovery.state==="found_verified","case should be verified");
must(lifecycleNoList.documentList.state==="not_requested","list must remain separate from case discovery");
must(lifecycleNoList.metadataBinding.state==="none"&&lifecycleNoList.download.state==="none"&&lifecycleNoList.integrity.state==="none","later stages must not be implied");
pass("case_found_does_not_imply_list_or_download");

const lifecycleMetadata=c.buildSingleCaseLifecycle({
  caseIdentity:identity,
  documentList:{queryState:"completed",validation:clean},
  metadataRows:[remoteVerified],
  physicalDocuments:[{downloaded:false,hashVerified:false}]
});
must(lifecycleMetadata.documentList.state==="completed_verified","verified list state wrong");
must(lifecycleMetadata.metadataBinding.state==="verified","metadata state wrong");
must(lifecycleMetadata.download.state==="not_downloaded","metadata must not imply download");
must(lifecycleMetadata.integrity.state==="unverified","metadata must not imply hash verification");
pass("metadata_verified_does_not_imply_download");

const lifecycleDownloaded=c.buildSingleCaseLifecycle({
  caseIdentity:identity,
  documentList:{queryState:"completed",validation:clean},
  metadataRows:[remoteVerified],
  physicalDocuments:[{downloaded:true,hashVerified:false}]
});
must(lifecycleDownloaded.download.state==="downloaded"&&lifecycleDownloaded.integrity.state==="unverified","download must not imply hash verification");
pass("downloaded_does_not_imply_hash_verified");

const lifecycleHash=c.buildSingleCaseLifecycle({
  caseIdentity:identity,
  documentList:{queryState:"completed",validation:clean},
  metadataRows:[remoteVerified],
  physicalDocuments:[{downloaded:true,hashVerified:true}]
});
must(lifecycleHash.integrity.state==="verified","hash-verified final stage missing");
pass("hash_verified_is_separate_final_stage");

const linkedRefresh=c.queryCapability({
  kind:"linked_case_document_refresh",
  caseId:93,
  uyapDosyaId:"FIXTURE-CASE93-DOSYA-ID"
});
must(linkedRefresh.supported&&linkedRefresh.executable&&linkedRefresh.route==="existing:enqueueCaseDocumentSync","linked-case refresh should be supported");
pass("linked_case_new_document_check_supported");

const targeted=c.queryCapability({
  kind:"targeted_case_search",
  yargiTuru:1,
  birimTuru2:"0926",
  court:"Kocaeli 3. İş Mahkemesi",
  year:2026,
  baseNumber:100
},{caseSearchSchemaVerified:true});
must(targeted.supported&&targeted.executable,"observed targeted case search should be supported");
pass("observed_targeted_case_search_supported");

const targetedBlocked=c.queryCapability({
  kind:"targeted_case_search",
  yargiTuru:1,
  birimTuru2:"0926",
  court:"Kocaeli 3. İş Mahkemesi",
  year:2026,
  baseNumber:100
},{caseSearchSchemaVerified:false});
must(!targetedBlocked.supported&&!targetedBlocked.executable&&targetedBlocked.reason==="observed_case_search_schema_required","unobserved targeted search must fail closed");
pass("unobserved_targeted_case_search_blocked");

const cbsParty=c.queryCapability({
  kind:"cbs_party_search",
  ilKodu:26,
  birimId:"FIXTURE-CBS-UNIT",
  partyName:"fixture runtime only",
  openedFrom:"2026-09-01",
  openedTo:"2026-10-01"
},{cbsSearchSchemaVerified:true,cbsPartyLookupVerified:true});
must(cbsParty.supported&&cbsParty.executable,"observed CBS party search should be supported");
pass("observed_cbs_party_search_supported");

for(const [kind,reason] of [
  ["cbs_investigation_number_search","direct_cbs_number_query_schema_not_observed"],
  ["talimat_direct_search","talimat_query_and_group_ownership_not_observed"],
  ["invented_future_query","unsupported_query_kind"]
]){
  const cap=c.queryCapability({kind});
  must(cap.supported===false&&cap.executable===false&&cap.reason===reason,kind+" must fail closed");
  pass(kind+"_fails_closed",{reason:cap.reason});
}

console.log(JSON.stringify({
  ok:true,
  fixture:"Eskişehir CBS 2026/51832 / case 93",
  liveUyapEvidence:false,
  warning:"No real case-93 UYAP payload is committed; opaque IDs are synthetic fixture values.",
  passed:results.length,
  results
},null,2));
