'use strict';
// Pure fail-closed planning boundary; never writes DB, enqueues or downloads.
const VERSION='bono.cbs-metadata-transfer.v1';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fail=(reason)=>({contractVersion:VERSION,state:'blocked',reason,metadataImportAllowed:false,downloadAllowed:false,records:[]});
function prepareMetadataTransfer(parsed,proof={}){
  if(parsed?.contractVersion!=='bono.cbs-document-list.v1')return fail('parser_contract_unverified');
  if(parsed.state!=='parsed'||parsed.parseState!=='parsed'||!parsed.binding?.verified||parsed.completeness?.capture!==true||parsed.completeness?.structure!==true)return fail('parser_or_capture_incomplete');
  if(proof.pagination?.verifiedComplete!==true||!Number.isSafeInteger(proof.pagination?.pagesObserved)||proof.pagination.pagesObserved<1)return fail('pagination_unverified');
  // Proof must be furnished by a privileged Core caller following fresh identity/capture verification.
  if(proof.origin!=='trusted_core'||proof.caseIdentity?.verified!==true||proof.capture?.verified!==true||proof.capture?.sessionBound!==true||proof.capture?.causallyBound!==true)return fail('trusted_core_proof_required');
  const target=proof.caseIdentity.identity?.uyapDosyaId;
  if(typeof target!=='string'||!target||target!==proof.capture.targetDosyaId||target!==proof.visibleFromUyapDosyaId)return fail('target_identity_mismatch');
  if(proof.capture?.eventId!==proof.eventId||!proof.eventId)return fail('event_identity_mismatch');
  if(!Array.isArray(parsed.occurrences)||!parsed.occurrences.length||!Array.isArray(parsed.logicalDocuments))return fail('documents_missing');
  const records=[],keys=new Set();
  for(const d of parsed.occurrences){
    const source=d?.source;
    if(typeof source?.uyapDosyaId!=='string'||!source.uyapDosyaId||typeof source.evrakId!=='string'||!source.evrakId)return fail('document_source_unverified');
    if(d.relationshipState!=='verified'||d.sourceMatchesTarget!==true||source.uyapDosyaId!==target)return fail('foreign_or_unverified_source');
    if(d.permission==='reported_denied')return fail('document_permission_denied');
    if(d.kind==='attachment'){
      if(!d.parentReference||d.parentIdentityEquality!=='verified'||typeof d.reportedParentId!=='string'||!d.reportedParentId)return fail('attachment_parent_unverified');
    }
    const key=JSON.stringify([source.uyapDosyaId,source.evrakId]);
    if(d.logicalKey!==key)return fail('logical_identity_conflict');
    if(keys.has(key))continue; // Exact source/document identity, never hash-based legal dedup.
    keys.add(key);
    records.push(Object.freeze({sourceUyapDosyaId:source.uyapDosyaId,evrakId:source.evrakId,
      visibleFromUyapDosyaId:target,kind:d.kind,ggEvrakId:own(d.metadata||{},'ggEvrakId')?d.metadata.ggEvrakId:null,
      reportedParentId:d.kind==='attachment'?d.reportedParentId:null,
      metadata:{...d.metadata},provenance:{eventId:proof.eventId,groupReference:d.groupReference,view:d.view}}));
  }
  if(parsed.logicalDocuments.length!==keys.size)return fail('logical_document_count_conflict');
  return {contractVersion:VERSION,state:'ready_for_core_review',reason:null,records,
    metadataImportAllowed:false,downloadAllowed:false,
    transactionPrerequisites:['fresh_case_identity_recheck','link_policy_check','atomic_db_validation','separate_user_import_approval'],
    downloadPrerequisites:['separate_user_download_approval','verified_download_reference','queue_pause_and_integrity_checks']};
}
module.exports={VERSION,prepareMetadataTransfer};
