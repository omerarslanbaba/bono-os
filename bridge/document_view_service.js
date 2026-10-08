"use strict";

const fs=require("fs");
const path=require("path");
const review=require("./case_document_review");

function fileExists(p){try{return !!p&&fs.existsSync(p)&&fs.statSync(p).isFile()}catch{return false}}
function extOf(doc){return path.extname(doc?.canonical?.path||"").toLowerCase()}
function mimeFor(ext){
  return ({".pdf":"application/pdf",".udf":"application/octet-stream",".txt":"text/plain; charset=utf-8",".html":"text/html; charset=utf-8",".htm":"text/html; charset=utf-8",".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".tif":"image/tiff",".tiff":"image/tiff"})[ext]||"application/octet-stream";
}
function loadRow(db,caseId,remoteDocumentDbId){
  return db.prepare(`SELECT
      rd.id remote_db_id,rd.case_id,rd.remote_document_id,rd.stable_key,rd.remote_title,rd.document_type,rd.document_date,
      rd.original_file_name,rd.remote_hash,rd.local_asset_id asset_id,rd.staging_path,rd.filed_path,rd.status,rd.metadata_json,
      c.uyap_dosya_id,
      a.sha256,a.file_name,a.extension,a.classification,a.archive_path,a.archive_policy,a.source_container,
      da.document_kind,da.raw_text,da.extracted_json,da.sections_json,da.analysis_status,da.engine_version,da.error
    FROM uyap_remote_documents rd
    JOIN cases c ON c.id=rd.case_id
    LEFT JOIN local_assets a ON a.id=rd.local_asset_id
    LEFT JOIN document_analysis da ON da.asset_id=a.id
    WHERE rd.case_id=? AND rd.id=?`).get(Number(caseId),Number(remoteDocumentDbId));
}
function loadDocument(db,caseId,remoteDocumentDbId,{verifyFiles=true,includeText=true}={}){
  const row=loadRow(db,caseId,remoteDocumentDbId);
  if(!row)return null;
  const locations=row.asset_id?db.prepare("SELECT local_path,source_root,last_seen_at FROM asset_locations WHERE asset_id=? ORDER BY id").all(row.asset_id):[];
  const chunks=row.asset_id?db.prepare("SELECT chunk_no,heading,text,metadata_json FROM knowledge_chunks WHERE asset_id=? AND (case_id=? OR case_id IS NULL) ORDER BY chunk_no").all(row.asset_id,Number(caseId)):[];
  return review.buildDocument(row,locations,chunks,{verifyFiles,includeText});
}
function downloadState(doc){
  const stagingPresent=fileExists(doc?._stagingPath);
  const canonicalPresent=!!doc?.canonical?.exists;
  const indexed=!!doc?.assetId;
  const remoteStatus=String(doc?.downloadStatus||"");
  const downloaded=canonicalPresent||stagingPresent||indexed||["downloaded","indexed","filed","summarized"].includes(remoteStatus);
  return {
    downloaded,
    remoteStatus:remoteStatus||null,
    localAssetIndexed:indexed,
    stagingPresent,
    canonicalPresent
  };
}
function viewerState(doc){
  const ext=extOf(doc);
  const canonicalReady=doc?.canonical?.exists===true&&doc?.canonical?.verified===true;
  const readable=doc?.extraction?.readable===true;
  if(!canonicalReady){
    return {
      mode:"blocked",
      openable:false,
      reason:doc?.canonical?.reason||"canonical_not_verified",
      contentType:null,
      disposition:null,
      textReadable:readable
    };
  }
  if(ext===".pdf"){
    return {mode:"pdf_inline",openable:true,reason:null,contentType:"application/pdf",disposition:"inline",textReadable:readable};
  }
  if(ext===".udf"){
    return {
      mode:readable?"udf_text":"udf_download_only",
      openable:true,
      reason:readable?null:(doc?.extraction?.error||"udf_text_unavailable"),
      contentType:"application/octet-stream",
      disposition:"attachment",
      textReadable:readable
    };
  }
  if([".jpg",".jpeg",".png"].includes(ext)){
    return {mode:"image_inline",openable:true,reason:null,contentType:mimeFor(ext),disposition:"inline",textReadable:false};
  }
  return {
    mode:"download_only",
    openable:true,
    reason:readable?null:"no_supported_inline_viewer",
    contentType:mimeFor(ext),
    disposition:"attachment",
    textReadable:readable
  };
}
function getDocumentView(db,caseId,remoteDocumentDbId,{verifyFiles=true,includeText=true}={}){
  const doc=loadDocument(db,caseId,remoteDocumentDbId,{verifyFiles,includeText});
  if(!doc)return {ok:false,statusCode:404,error:"document_not_found_in_case"};
  const view=viewerState(doc);
  const download={
    downloaded:doc.canonical.exists||!!doc.assetId||["downloaded","indexed","filed","summarized"].includes(String(doc.downloadStatus||"")),
    remoteStatus:doc.downloadStatus||null,
    localAssetIndexed:!!doc.assetId,
    canonicalPresent:doc.canonical.exists===true
  };
  return {
    ok:true,
    statusCode:200,
    document:{
      sourceId:doc.sourceId,
      caseId:doc.caseId,
      remoteDocumentDbId:doc.remoteDocumentDbId,
      remoteDocumentId:doc.remoteDocumentId,
      assetId:doc.assetId,
      name:doc.name,
      documentType:doc.documentType,
      normalizedKind:doc.normalizedKind,
      documentDate:doc.documentDate,
      uyap:doc.uyap,
      download,
      integrity:{
        canonicalPath:doc.canonical.path,
        exists:doc.canonical.exists,
        verified:doc.canonical.verified,
        sha256:doc.canonical.sha256,
        expectedSha256:doc.canonical.expectedSha256,
        reason:doc.canonical.reason
      },
      readability:{
        status:doc.extraction.status,
        readable:doc.extraction.readable,
        engine:doc.extraction.engine,
        error:doc.extraction.error,
        text:includeText&&doc.extraction.readable?doc.extraction.text:null,
        references:doc.extraction.references||[]
      },
      viewer:view,
      endpoints:{
        metadata:"/api/cases/"+doc.caseId+"/documents/"+doc.remoteDocumentDbId+"/view",
        content:view.openable?"/api/cases/"+doc.caseId+"/documents/"+doc.remoteDocumentDbId+"/content":null
      }
    }
  };
}
function authorizeDocumentContent(db,caseId,remoteDocumentDbId){
  const result=getDocumentView(db,caseId,remoteDocumentDbId,{verifyFiles:true,includeText:false});
  if(!result.ok)return result;
  const d=result.document;
  if(!d.integrity.exists)return {ok:false,statusCode:409,error:"canonical_file_missing"};
  if(d.integrity.verified!==true)return {ok:false,statusCode:412,error:"canonical_hash_not_verified",reason:d.integrity.reason};
  if(!d.viewer.openable)return {ok:false,statusCode:409,error:"document_not_openable",reason:d.viewer.reason};
  const file=d.integrity.canonicalPath;
  if(!fileExists(file))return {ok:false,statusCode:409,error:"canonical_file_missing"};
  return {
    ok:true,
    statusCode:200,
    caseId:Number(caseId),
    remoteDocumentDbId:Number(remoteDocumentDbId),
    assetId:d.assetId,
    path:file,
    contentType:d.viewer.contentType||mimeFor(path.extname(file).toLowerCase()),
    disposition:d.viewer.disposition||"attachment",
    fileName:path.basename(file),
    verifiedSha256:d.integrity.sha256
  };
}

module.exports={loadDocument,getDocumentView,authorizeDocumentContent,viewerState,mimeFor};
