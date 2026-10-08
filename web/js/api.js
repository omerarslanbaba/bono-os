async function request(path,options={}){
  const r=await fetch(path,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  let data=null;try{data=await r.json()}catch{data={error:'Geçersiz sunucu yanıtı'}}
  if(!r.ok)throw new Error(data?.error||('HTTP '+r.status));
  return data;
}
export const api={
  morningBrief:()=>request('/api/morning-brief'),
  upcomingHearings:(limit=30)=>request('/api/hearings/upcoming?limit='+encodeURIComponent(limit)),
  hearingCockpit:id=>request('/api/hearings/'+encodeURIComponent(id)+'/cockpit'),
  syncHearings:(start,end)=>request('/api/uyap/hearings/sync-range',{method:'POST',body:JSON.stringify({start,end})}),
  powers:()=>request('/api/powers'),
  power:id=>request('/api/powers/'+encodeURIComponent(id)),
  accountingOverview:(caseId=null)=>request('/api/accounting/overview'+(caseId!=null?'?caseId='+encodeURIComponent(caseId):'')),
  serviceHealth:()=>request('/api/service-health'),
  jobs:()=>request('/api/jobs'),
  uyapStatus:()=>request('/api/uyap/status'),
  uyapSession:()=>request('/api/uyap/session'),
  uyapDiscoveryStatus:()=>request('/api/uyap/discovery/status'),
  startUyapDiscovery:(opts={})=>request('/api/uyap/discovery/start',{method:'POST',body:JSON.stringify(opts)}),
  uyapArchiveStatus:()=>request('/api/uyap/archive/status'),
  startUyapArchive:()=>request('/api/uyap/archive/start',{method:'POST',body:'{}'}),
  uyapCases:()=>request('/api/uyap/cases'),
  uyapCaseSearchOptions:()=>request('/api/uyap/case-search/options'),
  searchUyapCase:payload=>request('/api/uyap/case-search',{method:'POST',body:JSON.stringify(payload)}),
  uyapCaseSearchStatus:searchId=>request('/api/uyap/case-search/'+encodeURIComponent(searchId)),
  uyapCbsPartySearchSchema:()=>request('/api/uyap/cbs-party-search-schema'),
  uyapCbsUnits:ilKodu=>request('/api/uyap/cbs-units?ilKodu='+encodeURIComponent(ilKodu)),
  searchUyapCbsParty:payload=>request('/api/uyap/cbs-party-search',{method:'POST',body:JSON.stringify(payload)}),
  uyapCbsPartySearchStatus:searchId=>request('/api/uyap/cbs-party-search/'+encodeURIComponent(searchId)),
  uyapRemoteDocuments:caseId=>request('/api/uyap/cases/'+encodeURIComponent(caseId)+'/remote-documents'),
  caseDocumentView:(caseId,documentId)=>request('/api/cases/'+encodeURIComponent(caseId)+'/documents/'+encodeURIComponent(documentId)+'/view'),
  caseDocumentContentUrl:(caseId,documentId)=>'/api/cases/'+encodeURIComponent(caseId)+'/documents/'+encodeURIComponent(documentId)+'/content',
  syncUyapDocuments:caseId=>request('/api/uyap/cases/'+encodeURIComponent(caseId)+'/sync-documents',{method:'POST',body:'{}'}),
  uyapDocumentSyncStatus:caseId=>request('/api/uyap/cases/'+encodeURIComponent(caseId)+'/document-sync-status'),
  uyapDownloadSummary:caseId=>request('/api/uyap/cases/'+encodeURIComponent(caseId)+'/download-summary'),
  queueMissingUyapDocuments:(caseId,limit=200)=>request('/api/uyap/cases/'+encodeURIComponent(caseId)+'/download-missing',{method:'POST',body:JSON.stringify({limit,confirmed:true})}),
  downloadUyapDocument:id=>request('/api/uyap/remote-documents/'+encodeURIComponent(id)+'/download',{method:'POST',body:'{}'})
};
