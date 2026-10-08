(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BONO_OBSERVATION_CONTRACTS=factory();
})(typeof window==='object'?window:this,function(){
  'use strict';
  const version='uyap.contracts.v1';
  const contracts=[
    {id:'cbs.list',path:'/avukat_dosya_sorgula_cbs_brd.ajx',purpose:'CBS dosya listesi',family:'cbs',evidence:'existing-command-list-schema',confidence:'observed',parameters:{},executable:false},
    {id:'cbs.units',path:'/cbs_birim_sorgula.ajx',purpose:'CBS birimleri',family:'cbs',evidence:'existing-observer-allowlist',confidence:'schema_unknown',parameters:{},executable:false},
    {id:'court.list',path:'/search_phrase_detayli.ajx',purpose:'Mahkeme dosya listesi',family:'court',evidence:'existing-observer-allowlist',confidence:'schema_unknown',parameters:{},executable:false},
    {id:'hearings.list',path:'/avukat_durusma_sorgula_brd.ajx',purpose:'Duruşma listesi',family:'court',evidence:'existing-observer-allowlist',confidence:'schema_unknown',parameters:{},executable:false},
    {id:'documents.list',path:'/list_dosya_evraklar.ajx',purpose:'Evrak metadata listesi',family:'shared',evidence:'existing-observation-schema',confidence:'request_fields_observed',parameters:{dosyaId:'opaque; lifetime and equality semantics unknown',pageNumber:'pagination field; base unknown'},executable:false},
    {id:'documents.pages',path:'/listDosyaEvraklarPageTotal.ajx',purpose:'Evrak sayfalama',family:'shared',evidence:'existing-observation-schema',confidence:'response_schema_unknown',parameters:{dosyaId:'opaque; meaning unknown'},executable:false}
  ].map(c=>({...c,method:'unknown',screen:'unknown',preconditions:['authorized session','explicit operation approval'],responseSchema:'unknown',errors:['PRTL_GNL_1-1'],fixture:'scripts/test_uyap_observation_contracts.js'}));
  function contract(path){return contracts.find(c=>c.path===path)||null;}
  function applicationError(data){
    if(!data||typeof data!=='object'||Array.isArray(data))return null;
    if(typeof data.errorCode==='string'&&data.errorCode)return {code:data.errorCode==='PRTL_GNL_1-1'?data.errorCode:'unknown',category:data.errorCode==='PRTL_GNL_1-1'?'authorization':'unknown_application_error'};
    return null;
  }
  // Deliberately no general response parser. Group shapes are evidence, not ownership.
  function responseEvidence(data){
    if(!data||typeof data!=='object')return null;
    const groups=data.tumEvraklar;
    return {applicationError:applicationError(data),pageTotal:Number.isSafeInteger(data.pageTotal)?data.pageTotal:null,
      recentCount:Array.isArray(data.son20Evrak)?data.son20Evrak.length:null,
      groupShape:Array.isArray(groups)?'array':groups&&typeof groups==='object'?'object':'unknown',
      groups:groups&&!Array.isArray(groups)&&typeof groups==='object'?Object.entries(groups).slice(0,100).map(([label,items])=>({label:/^20\d{2}\/\d+(?:\([^\r\n]{1,80}\))?$/.test(label)?label:'unknown',shape:Array.isArray(items)?'array':typeof items,count:Array.isArray(items)?items.length:null})):[],
      ownership:'unknown'};
  }
  function assertImportAllowed(caseRow){
    if(!caseRow)throw new Error('case_not_found');
    if(/cbs|savc|soru.turma/i.test(String(caseRow.case_type||'')+' '+String(caseRow.court||'')))throw new Error('cbs_document_ownership_unverified');
  }
  return {version,contracts,contract,responseEvidence,applicationError,assertImportAllowed};
});
