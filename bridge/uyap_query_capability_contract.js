"use strict";

const caseDocumentContract=require("./uyap_case_document_contract");

const CONTRACT_VERSION="uyap.query-capability-diagnostic.v1";
const CASE_KINDS=new Set(["court","cbs","enforcement","instruction","unknown"]);
const SYNTHETIC_RE=/(fixture|synthetic|sentetik|test(?:_|\b)|mock|fake)/i;
const TRUSTED_LIVE_SOURCE_TYPES=new Set([
  "authorized observation","live observation","persisted live observation","uyap observation"
]);

function trFold(value){
  return String(value??"")
    .replace(/İ/g,"I").replace(/ı/g,"i")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}

function classifyCaseKind(input={}){
  const explicit=trFold(input.caseKind||input.kind);
  const aliases={
    court:"court",mahkeme:"court",mahkemesi:"court",hakimlik:"court",hakimligi:"court",
    cbs:"cbs",savcilik:"cbs",savciligi:"cbs",sorusturma:"cbs",
    enforcement:"enforcement",icra:"enforcement",icra_dairesi:"enforcement",
    instruction:"instruction",talimat:"instruction"
  };
  if(aliases[explicit])return aliases[explicit];
  if(CASE_KINDS.has(explicit))return explicit;
  const hay=trFold([input.court,input.unit,input.caseType,input.fileType].filter(Boolean).join(" "));
  if(/\btalimat\b/.test(hay))return "instruction";
  if(/\b(cumhuriyet bassavciligi|bassavcilik|savcilik|sorusturma)\b/.test(hay))return "cbs";
  if(/\bicra\b/.test(hay))return "enforcement";
  if(/\b(mahkeme|mahkemesi|hakimlik|hakimligi|hukuk|ceza)\b/.test(hay))return "court";
  return "unknown";
}

function evidenceLabel(evidence={}){
  return [evidence.sourceType,evidence.source,evidence.label,evidence.note].filter(Boolean).join(" ");
}
function isLiveEvidence(evidence){
  if(!evidence||evidence.liveObserved!==true)return false;
  if(SYNTHETIC_RE.test(evidenceLabel(evidence)))return false;
  return TRUSTED_LIVE_SOURCE_TYPES.has(trFold(evidence.sourceType));
}
function liveSchemaVerified(evidence){
  return !!evidence&&evidence.schemaVerified===true&&isLiveEvidence(evidence);
}

function identityEvidenceStatus(caseIdentity){
  const evidence=caseIdentity||{};
  const reason=String(evidence.reason||"");
  if(evidence.state==="mismatch"||/mismatch/i.test(reason)){
    return {state:"mismatch",verified:false,liveVerified:false,reasonCode:"IDENTITY_MISMATCH"};
  }
  const structural=evidence.verified===true||evidence.state==="verified";
  if(structural&&isLiveEvidence(evidence)){
    return {state:"verified",verified:true,liveVerified:true,reasonCode:null};
  }
  if(structural){
    return {state:"verification_pending",verified:false,liveVerified:false,reasonCode:"IDENTITY_LIVE_EVIDENCE_REQUIRED"};
  }
  return {state:"verification_pending",verified:false,liveVerified:false,reasonCode:"IDENTITY_NOT_VERIFIED"};
}

function documentListEvidenceStatus(evidence={}){
  const missing=[];
  const endpointObserved=evidence.endpointObserved===true;
  const responseObserved=evidence.responseObserved===true;
  const path=String(evidence.path||"").trim();
  const method=String(evidence.method||"").trim().toUpperCase();
  const shapeKnown=evidence.responseShapeRecognized===true||!!String(evidence.responseShape||"").trim();
  if(!endpointObserved)missing.push("document_list_endpoint_observation");
  if(!path)missing.push("document_list_endpoint_path");
  if(!method)missing.push("document_list_method");
  if(!responseObserved)missing.push("document_list_response_observation");
  if(!shapeKnown)missing.push("document_list_response_shape");
  if(!isLiveEvidence(evidence))missing.push("document_list_live_observation");
  const verified=missing.length===0;
  return {
    state:verified?"verified":"verification_pending",
    verified,
    liveVerified:verified,
    reasonCode:verified?null:"DOCUMENT_LIST_LIVE_EVIDENCE_REQUIRED",
    endpoint:path||null,
    method:method||null,
    responseShape:evidence.responseShape||null,
    missing:[...new Set(missing)]
  };
}

function ownershipEvidenceStatus({caseKind,caseIdentity,ownershipEvidence,documentListResponse}={}){
  let validation=ownershipEvidence?.validation||null;
  const identity=caseIdentity?.identity||caseIdentity||null;
  if(!validation&&documentListResponse&&identity){
    validation=caseDocumentContract.validateDocumentListOwnership(identity,documentListResponse);
  }
  const source=ownershipEvidence||{};
  const live=isLiveEvidence(source);
  const groupRule=(caseKind==="cbs"||caseKind==="instruction")
    ? "group_label_context_only"
    : "group_label_not_required_as_proof";
  if(!validation){
    return {
      state:"not_observed",verified:false,liveVerified:false,bindAllowed:false,
      reasonCode:"OWNERSHIP_NOT_OBSERVED",groupRule,validation:null
    };
  }
  if(validation.state==="verified"&&live){
    return {
      state:"verified",verified:true,liveVerified:true,bindAllowed:true,
      reasonCode:null,groupRule,validation
    };
  }
  if(validation.state==="verified"){
    return {
      state:"verification_pending",verified:false,liveVerified:false,bindAllowed:false,
      reasonCode:"OWNERSHIP_LIVE_EVIDENCE_REQUIRED",groupRule,validation
    };
  }
  if(validation.state==="partial"){
    return {
      state:"mixed",verified:false,liveVerified:false,bindAllowed:false,
      reasonCode:"OWNERSHIP_MIXED_OR_UNVERIFIED",groupRule,validation
    };
  }
  const hasForeign=Number(validation?.counts?.foreign||validation?.foreign?.length||0)>0;
  return {
    state:hasForeign?"foreign_or_rejected":"unverified",
    verified:false,liveVerified:false,bindAllowed:false,
    reasonCode:hasForeign?"OWNERSHIP_FOREIGN_ITEMS_PRESENT":"OWNERSHIP_UNVERIFIED",
    groupRule,validation
  };
}

function discoveryFlowSupport(caseKind,{flowEvidence={},discoveryMode="auto"}={}){
  if(caseKind==="court"){
    const ok=liveSchemaVerified(flowEvidence.caseSearch);
    return {
      supportState:ok?"supported":"verification_pending",
      flowId:"targeted_case_search",
      executableByContract:ok,
      reasonCode:ok?null:"COURT_SEARCH_LIVE_SCHEMA_REQUIRED"
    };
  }
  if(caseKind==="cbs"){
    if(discoveryMode==="investigation_number"){
      const alternativeOk=liveSchemaVerified(flowEvidence.cbsSearch)&&liveSchemaVerified(flowEvidence.cbsPartyLookup);
      return {
        supportState:"unsupported",flowId:"cbs_investigation_number_search",executableByContract:false,
        reasonCode:"DIRECT_CBS_NUMBER_FLOW_UNSUPPORTED",
        alternativeFlow:alternativeOk?{flowId:"cbs_party_search",supportState:"supported"}:null
      };
    }
    const ok=liveSchemaVerified(flowEvidence.cbsSearch)&&liveSchemaVerified(flowEvidence.cbsPartyLookup);
    return {
      supportState:ok?"supported":"verification_pending",
      flowId:"cbs_party_search",executableByContract:ok,
      reasonCode:ok?null:"CBS_PARTY_SEARCH_LIVE_SCHEMAS_REQUIRED",
      limitation:"direct_investigation_number_query_unsupported"
    };
  }
  if(caseKind==="enforcement"){
    const ok=liveSchemaVerified(flowEvidence.enforcementSearch);
    return {
      supportState:ok?"supported":"verification_pending",
      flowId:ok?(flowEvidence.enforcementSearch.flowId||"observed_enforcement_search"):null,
      executableByContract:ok,
      reasonCode:ok?null:"ENFORCEMENT_SEARCH_FLOW_UNVERIFIED"
    };
  }
  if(caseKind==="instruction"){
    return {
      supportState:"unsupported",flowId:"talimat_direct_search",executableByContract:false,
      reasonCode:"TALIMAT_DIRECT_FLOW_UNSUPPORTED"
    };
  }
  return {
    supportState:"verification_pending",flowId:null,executableByContract:false,
    reasonCode:"CASE_KIND_UNCLASSIFIED"
  };
}

function documentListFlowSupport(caseKind,documentEvidence){
  if(caseKind==="instruction"){
    return {supportState:"unsupported",flowId:"linked_case_document_refresh",reasonCode:"TALIMAT_DOCUMENT_FLOW_UNVERIFIED"};
  }
  if(caseKind==="enforcement"){
    const scoped=Array.isArray(documentEvidence?.caseKinds)&&documentEvidence.caseKinds.includes("enforcement");
    const live=scoped&&documentListEvidenceStatus(documentEvidence).verified;
    return {
      supportState:live?"supported":"verification_pending",flowId:"linked_case_document_refresh",
      reasonCode:live?null:"ENFORCEMENT_DOCUMENT_FLOW_UNVERIFIED"
    };
  }
  if(caseKind==="court"||caseKind==="cbs"){
    return {supportState:"supported",flowId:"linked_case_document_refresh",reasonCode:null};
  }
  return {supportState:"verification_pending",flowId:null,reasonCode:"CASE_KIND_UNCLASSIFIED"};
}

function sessionStatus(session){
  const raw=typeof session==="string"?session:session?.state;
  const state=String(raw||"unknown");
  if(state==="ready")return {state:"ready",ready:true,reasonCode:null};
  if(state==="login_required")return {state,ready:false,reasonCode:"SESSION_LOGIN_REQUIRED"};
  return {state:"unknown",ready:false,reasonCode:"SESSION_STATE_UNKNOWN"};
}

function failureStatus(lastFailure){
  if(!lastFailure)return null;
  const kind=trFold(lastFailure.kind||lastFailure.category||lastFailure.code);
  const status=Number(lastFailure.status||lastFailure.httpStatus||0);
  const text=trFold([lastFailure.message,lastFailure.error].filter(Boolean).join(" "));
  if(kind==="auth"||kind==="session"||status===401||status===403||/\b(auth|login|oturum)\b/.test(text)){
    return {category:"session",code:"SESSION_LOGIN_REQUIRED"};
  }
  if(kind==="transient"||[408,425,429,502,503,504].includes(status)||status>=500||/timeout|temporar|network|econn|reset/.test(text)){
    return {category:"transient_error",code:"TRANSIENT_UYAP_ERROR"};
  }
  return {category:"verification_pending",code:"UNCLASSIFIED_UYAP_FAILURE"};
}

function blocker(category,code,messageTr,priority){return {category,code,messageTr,priority}}

const MESSAGES={
  IDENTITY_MISMATCH:"UYAP kimliği hedef dosyayla uyuşmuyor; sorgu ve bağlama durduruldu.",
  IDENTITY_LIVE_EVIDENCE_REQUIRED:"UYAP kimliği yalnız sentetik/yerel kanıtla eşleşiyor; canlı doğrulama bekleniyor.",
  IDENTITY_NOT_VERIFIED:"Dosyanın UYAP kimliği henüz doğrulanmadı.",
  DOCUMENT_LIST_LIVE_EVIDENCE_REQUIRED:"document.list için gerçek endpoint ve response kanıtı eksik.",
  SESSION_LOGIN_REQUIRED:"UYAP oturumu gerekli.",
  SESSION_STATE_UNKNOWN:"UYAP oturum durumu doğrulanamadı.",
  TRANSIENT_UYAP_ERROR:"UYAP geçici olarak yanıt vermedi; aynı salt-okunur işlem güvenle yeniden denenebilir.",
  UNCLASSIFIED_UYAP_FAILURE:"Son UYAP hatasının türü doğrulanamadı; otomatik yeniden deneme yetkisi verilmedi.",
  TALIMAT_DOCUMENT_FLOW_UNVERIFIED:"Talimat dosyası için doğrulanmış document.list akışı yok.",
  ENFORCEMENT_DOCUMENT_FLOW_UNVERIFIED:"İcra dosyası için document.list akışının canlı kanıtı eksik.",
  CASE_KIND_UNCLASSIFIED:"Dosya türü güvenle sınıflandırılamadı; sorgu akışı doğrulanmayı bekliyor.",
  OWNERSHIP_MIXED_OR_UNVERIFIED:"Evrak listesinde karışık veya doğrulanmamış aidiyet var; dosyaya bağlama kapalı.",
  OWNERSHIP_FOREIGN_ITEMS_PRESENT:"Başka UYAP dosyasına ait evrak kanıtı var; otomatik bağlama kapalı.",
  OWNERSHIP_UNVERIFIED:"Evrak aidiyeti doğrulanamadı; otomatik bağlama kapalı.",
  OWNERSHIP_LIVE_EVIDENCE_REQUIRED:"Evrak aidiyeti yalnız sentetik/yerel veride doğrulandı; canlı kanıt bekleniyor.",
  OWNERSHIP_NOT_OBSERVED:"Evrak aidiyeti henüz gözlenmedi; sorgu sonucu gelmeden otomatik bağlama yapılamaz.",
  DIRECT_CBS_NUMBER_FLOW_UNSUPPORTED:"CBS dosyasını soruşturma numarasıyla doğrudan sorgulayan doğrulanmış akış yok.",
  TALIMAT_DIRECT_FLOW_UNSUPPORTED:"Talimat dosyasını doğrudan sorgulayan doğrulanmış akış yok.",
  ENFORCEMENT_SEARCH_FLOW_UNVERIFIED:"İcra dosyası keşif/sorgu akışı canlı olarak doğrulanmayı bekliyor.",
  COURT_SEARCH_LIVE_SCHEMA_REQUIRED:"Mahkeme hedefli arama şemasının canlı gözlem kanıtı eksik.",
  CBS_PARTY_SEARCH_LIVE_SCHEMAS_REQUIRED:"CBS taraf araması için canlı CBS liste + taraf lookup kanıtı eksik."
};

function addFlowBlocker(list,flow,scope){
  const before=list.length;
  if(flow.supportState==="unsupported")list.push(blocker("unsupported_flow",flow.reasonCode,MESSAGES[flow.reasonCode]||"Bu sorgu akışı desteklenmiyor.",90));
  else if(flow.supportState==="verification_pending")list.push(blocker("verification_pending",flow.reasonCode,MESSAGES[flow.reasonCode]||"Bu sorgu akışı doğrulanmayı bekliyor.",55));
  if(list.length>before)list[list.length-1].scope=scope;
}

function safeNextAction({primaryOperation,primaryBlocker,caseKind,discovery,canQueryDocumentList,ownership}){
  const code=primaryBlocker?.code||null;
  if(code==="IDENTITY_MISMATCH")return {code:"REVIEW_IDENTITY",allowed:false,labelTr:"Hedef dosya ile UYAP kimliğini manuel olarak karşılaştır."};
  if(code==="SESSION_LOGIN_REQUIRED")return {code:"RESTORE_UYAP_SESSION",allowed:false,labelTr:"UYAP oturumunu yenile; sonra aynı salt-okunur işlemi yeniden değerlendir."};
  if(code==="TRANSIENT_UYAP_ERROR")return {code:"RETRY_READ_ONLY_QUERY",allowed:true,labelTr:"Aynı salt-okunur sorguyu yeniden dene."};
  if(code==="DIRECT_CBS_NUMBER_FLOW_UNSUPPORTED"){
    if(discovery.alternativeFlow?.supportState==="supported")return {code:"USE_CBS_PARTY_SEARCH",allowed:true,labelTr:"Doğrulanmış CBS taraf + birim + tarih aralığı akışını kullan."};
    return {code:"OBSERVE_CBS_DIRECT_FLOW",allowed:false,labelTr:"Doğrudan soruşturma no akışı için yetkili gözlem kanıtı topla."};
  }
  if(code==="TALIMAT_DIRECT_FLOW_UNSUPPORTED"||code==="TALIMAT_DOCUMENT_FLOW_UNVERIFIED")return {code:"OBSERVE_TALIMAT_FLOW",allowed:false,labelTr:"Talimat akışı için yetkili endpoint/response ve aidiyet kanıtı topla."};
  if(code==="ENFORCEMENT_SEARCH_FLOW_UNVERIFIED"||code==="ENFORCEMENT_DOCUMENT_FLOW_UNVERIFIED")return {code:"OBSERVE_ENFORCEMENT_FLOW",allowed:false,labelTr:"İcra dosyası akışını canlı ve dar kapsamlı gözlemle doğrula."};
  if(code==="IDENTITY_LIVE_EVIDENCE_REQUIRED"||code==="IDENTITY_NOT_VERIFIED"){
    if(discovery.supportState==="supported")return {code:"RUN_VERIFIED_DISCOVERY_FLOW",allowed:true,labelTr:"Doğrulanmış salt-okunur keşif akışıyla UYAP kimliğini doğrula."};
    return {code:"VERIFY_IDENTITY_EVIDENCE",allowed:false,labelTr:"UYAP kimliği için canlı ve yetkili kanıt elde et."};
  }
  if(code==="DOCUMENT_LIST_LIVE_EVIDENCE_REQUIRED")return {code:"OBSERVE_DOCUMENT_LIST_CONTRACT",allowed:false,labelTr:"document.list endpoint ve response şeklini canlı yetkili gözlemle doğrula."};
  if(code&&code.startsWith("OWNERSHIP_"))return {code:"VALIDATE_DOCUMENT_OWNERSHIP",allowed:false,labelTr:"PR #17 aidiyet doğrulayıcısıyla item dosyaId/evrakId kanıtını tamamla."};
  if(primaryOperation==="bind_documents"&&ownership.bindAllowed)return {code:"PERSIST_OWNED_ITEMS_IN_INTEGRATION",allowed:true,labelTr:"Yalnız doğrulanmış owned item'ları entegrasyon katmanında işle."};
  if(canQueryDocumentList)return {code:"RUN_DOCUMENT_LIST_READ_ONLY",allowed:true,labelTr:"Yalnız bu dosya için document.list sorgusunu çalıştır; indirme başlatma."};
  if(caseKind==="cbs"&&discovery.supportState==="supported")return {code:"RUN_VERIFIED_DISCOVERY_FLOW",allowed:true,labelTr:"Doğrulanmış CBS taraf aramasıyla kimliği doğrula."};
  return {code:"NO_AUTOMATIC_ACTION",allowed:false,labelTr:"Eksik kanıt tamamlanmadan otomatik sorgu veya bağlama yapma."};
}

function diagnoseUyapCaseCapability(input={}){
  const caseKind=classifyCaseKind(input.case||input);
  const primaryOperation=String(input.operation||"document_list_query");
  const identity=identityEvidenceStatus(input.caseIdentity);
  const documentEvidence=documentListEvidenceStatus(input.documentListEvidence||{});
  const ownership=ownershipEvidenceStatus({
    caseKind,
    caseIdentity:input.caseIdentity,
    ownershipEvidence:input.ownershipEvidence,
    documentListResponse:input.documentListResponse
  });
  const session=sessionStatus(input.session);
  const lastFailure=failureStatus(input.lastFailure);
  const discovery=discoveryFlowSupport(caseKind,{
    flowEvidence:input.flowEvidence||{},
    discoveryMode:input.discoveryMode||"auto"
  });
  const documentList=documentListFlowSupport(caseKind,input.documentListEvidence||{});

  const blockers=[];
  if(identity.state==="mismatch")blockers.push(blocker("identity_mismatch","IDENTITY_MISMATCH",MESSAGES.IDENTITY_MISMATCH,100));
  if(primaryOperation==="discover_case")addFlowBlocker(blockers,discovery,"discovery");
  else addFlowBlocker(blockers,documentList,"document_list");
  if(primaryOperation!=="discover_case"&&identity.state==="verification_pending")blockers.push(blocker("verification_pending",identity.reasonCode,MESSAGES[identity.reasonCode],80));
  if(primaryOperation!=="discover_case"&&documentList.supportState==="supported"&&!documentEvidence.verified)blockers.push(blocker("verification_pending","DOCUMENT_LIST_LIVE_EVIDENCE_REQUIRED",MESSAGES.DOCUMENT_LIST_LIVE_EVIDENCE_REQUIRED,70));
  if(session.state==="login_required")blockers.push(blocker("session","SESSION_LOGIN_REQUIRED",MESSAGES.SESSION_LOGIN_REQUIRED,85));
  else if(session.state!=="ready")blockers.push(blocker("verification_pending","SESSION_STATE_UNKNOWN",MESSAGES.SESSION_STATE_UNKNOWN,60));
  if(lastFailure){
    if(lastFailure.category==="session"&&!blockers.some(x=>x.code==="SESSION_LOGIN_REQUIRED"))blockers.push(blocker("session",lastFailure.code,MESSAGES[lastFailure.code],85));
    if(lastFailure.category==="transient_error")blockers.push(blocker("transient_error",lastFailure.code,MESSAGES[lastFailure.code],75));
    if(lastFailure.category==="verification_pending")blockers.push(blocker("verification_pending",lastFailure.code,MESSAGES[lastFailure.code],50));
  }
  if(primaryOperation==="bind_documents"&&!ownership.bindAllowed){
    blockers.push(blocker("ownership",ownership.reasonCode,MESSAGES[ownership.reasonCode],88));
  }

  blockers.sort((a,b)=>b.priority-a.priority);
  const primaryBlocker=blockers[0]||null;
  const operationFlow=primaryOperation==="discover_case"?discovery:documentList;
  const supportState=operationFlow.supportState;
  const canDiscoverCase=discovery.supportState==="supported"&&session.ready&&identity.state!=="mismatch";
  const canQueryDocumentList=documentList.supportState==="supported"&&identity.liveVerified&&documentEvidence.verified&&session.ready&&
    !lastFailure?.category&&identity.state!=="mismatch";
  const canBindDocuments=identity.liveVerified&&ownership.bindAllowed&&identity.state!=="mismatch";

  const missingEvidence=[];
  if(!identity.liveVerified&&identity.state!=="mismatch")missingEvidence.push(identity.reasonCode);
  if(!documentEvidence.verified)missingEvidence.push(...documentEvidence.missing);
  if(documentList.supportState==="verification_pending")missingEvidence.push(documentList.reasonCode);
  if(discovery.supportState==="verification_pending")missingEvidence.push(discovery.reasonCode);
  if(primaryOperation==="bind_documents"&&!ownership.bindAllowed)missingEvidence.push(ownership.reasonCode);

  let availabilityState="ready";
  if(supportState==="unsupported")availabilityState="unsupported";
  else if(primaryBlocker?.category==="verification_pending"||supportState==="verification_pending")availabilityState="verification_pending";
  else if(primaryBlocker)availabilityState="blocked";

  const userStatus=primaryBlocker
    ? {state:availabilityState,shortTr:primaryBlocker.messageTr}
    : primaryOperation==="bind_documents"
      ? {state:"ready",shortTr:"UYAP kimliği ve evrak aidiyeti doğrulandı; yalnız owned item'lar işlenebilir."}
      : primaryOperation==="discover_case"
        ? {state:"ready",shortTr:"Bu dosya türü için doğrulanmış salt-okunur keşif akışı kullanılabilir."}
        : {state:"ready",shortTr:"Bu dosya için document.list sorgusu yapılabilir; evraklar aidiyet doğrulamasından geçmeden bağlanmaz."};

  const nextAction=safeNextAction({primaryOperation,primaryBlocker,caseKind,discovery,canQueryDocumentList,ownership});

  return {
    contractVersion:CONTRACT_VERSION,
    caseKind,
    operation:primaryOperation,
    supportState,
    availabilityState,
    identity,
    flows:{discovery,documentList},
    documentListEvidence:documentEvidence,
    ownership,
    session,
    lastFailure,
    permissions:{
      canDiscoverCase,
      canQueryDocumentList,
      canBindDocuments,
      groupLabelMayProveOwnership:false
    },
    blockers:blockers.map(({priority,...rest})=>rest),
    primaryBlocker:primaryBlocker?((({priority,...rest})=>rest)(primaryBlocker)):null,
    missingEvidence:[...new Set(missingEvidence.filter(Boolean))],
    safeNextAction:nextAction,
    userStatus
  };
}

module.exports={
  CONTRACT_VERSION,
  classifyCaseKind,
  isLiveEvidence,
  identityEvidenceStatus,
  documentListEvidenceStatus,
  ownershipEvidenceStatus,
  discoveryFlowSupport,
  documentListFlowSupport,
  failureStatus,
  diagnoseUyapCaseCapability
};
