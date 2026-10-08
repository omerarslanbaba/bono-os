"use strict";

const fs=require("fs");
const path=require("path");
const {execFile}=require("child_process");
const {sha256File}=require("./archive_safety");

const ROOT=path.resolve(__dirname,"..");
const EXTRACTOR=path.join(ROOT,"scripts","extract_review_text.py");

function nrm(s){
  return String(s||"").replace(/İ/g,"I").replace(/ı/g,"i").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function parseJson(v,fallback=null){try{return v?JSON.parse(v):fallback}catch{return fallback}}
function fileExists(p){try{return !!p&&fs.existsSync(p)&&fs.statSync(p).isFile()}catch{return false}}
function runExtractor(file){
  return new Promise((resolve,reject)=>{
    execFile("py",["-3",EXTRACTOR,path.resolve(file)],{cwd:ROOT,windowsHide:true,maxBuffer:50*1024*1024},(err,stdout,stderr)=>{
      const line=String(stdout||"").trim().split(/\r?\n/).filter(Boolean).pop()||"";
      if(err&&!line)return reject(new Error(String(stderr||err.message).trim()));
      try{resolve(JSON.parse(line))}catch{reject(new Error("Belge inceleme motorundan geçersiz JSON: "+line.slice(0,500)))}
    });
  });
}
function normalizeKind(row){
  const source=nrm([
    row.document_kind,row.document_type,row.remote_title,row.original_file_name,row.file_name,row.classification
  ].filter(Boolean).join(" "));
  if(/durusma (zapt|tutanak)|durusma zapti|durusma tutanagi/.test(source))return "duruşma_tutanağı";
  if(/gerekceli karar/.test(source))return "gerekçeli_karar";
  if(/bilirkisi.*rapor|uzman rapor/.test(source))return "bilirkişi_raporu";
  if(/dava dilek/.test(source))return "dava_dilekçesi";
  if(/cevap dilek/.test(source))return "cevap_dilekçesi";
  if(/beyan dilek|beyan evrak|beyan/.test(source))return "beyan_dilekçesi";
  if(/savunma/.test(source))return "savunma_dilekçesi";
  if(/iddianame/.test(source))return "iddianame";
  if(/tensip/.test(source))return "tensip";
  if(/istinaf/.test(source))return "istinaf";
  if(/temyiz/.test(source))return "temyiz";
  if(/karar/.test(source))return "karar";
  if(/dilekce/.test(source))return "dilekçe";
  if(/rapor/.test(source))return "rapor";
  return row.document_kind||row.classification||row.document_type||"belge";
}
function canonicalState(row,locations,{verifyFiles=true}={}){
  const candidates=[
    row.filed_path,
    row.archive_path,
    ...(locations||[]).map(x=>x.local_path)
  ].filter(Boolean);
  let p=null;
  for(const c of candidates){if(fileExists(c)){p=path.resolve(c);break}}
  if(!p)return {path:null,exists:false,verified:false,sha256:null,expectedSha256:row.sha256||row.remote_hash||null,reason:"canonical_file_not_found"};
  const expected=String(row.sha256||row.remote_hash||"").toLowerCase()||null;
  if(!verifyFiles)return {path:p,exists:true,verified:null,sha256:null,expectedSha256:expected,reason:"verification_not_requested"};
  const actual=sha256File(p);
  if(!expected)return {path:p,exists:true,verified:false,sha256:actual,expectedSha256:null,reason:"missing_expected_sha256"};
  return {path:p,exists:true,verified:actual===expected,sha256:actual,expectedSha256:expected,reason:actual===expected?null:"sha256_mismatch"};
}
function extractionState(row){
  const status=String(row.analysis_status||"").trim();
  const raw=String(row.raw_text||"");
  if(status==="completed"&&raw.trim())return {status:"extracted",engine:row.engine_version||null,error:null};
  if(status==="no_text")return {status:"no_text",engine:row.engine_version||null,error:row.error||"no_embedded_text_or_scan_requires_ocr"};
  if(status==="failed")return {status:"failed",engine:row.engine_version||null,error:row.error||"analysis_failed"};
  if(status==="completed")return {status:"no_text",engine:row.engine_version||null,error:"analysis_completed_without_text"};
  return {status:"not_analyzed",engine:row.engine_version||null,error:null};
}
function referencesFor(row,chunks){
  const out=[];
  for(const ch of chunks||[]){
    const meta=parseJson(ch.metadata_json,{})||{};
    const refType=meta.page?"page":(ch.heading?"section_or_chunk":"chunk");
    out.push({
      sourceRef:"uyap-remote:"+row.remote_db_id+":chunk:"+ch.chunk_no,
      kind:refType,
      page:meta.page||null,
      heading:ch.heading||null,
      chunkNo:ch.chunk_no,
      text:ch.text||""
    });
  }
  if(out.length)return out;
  const sections=parseJson(row.sections_json,[])||[];
  if(Array.isArray(sections)){
    sections.forEach((s,i)=>{
      if(!s||!String(s.text||"").trim())return;
      out.push({
        sourceRef:"uyap-remote:"+row.remote_db_id+":section:"+i,
        kind:"section",
        page:null,
        heading:s.heading||null,
        startParagraph:Number.isFinite(Number(s.startParagraph))?Number(s.startParagraph):null,
        chunkNo:null,
        text:String(s.text||"")
      });
    });
  }
  if(out.length)return out;
  if(String(row.raw_text||"").trim()){
    out.push({
      sourceRef:"uyap-remote:"+row.remote_db_id+":document",
      kind:"document",
      page:null,
      heading:null,
      chunkNo:null,
      text:String(row.raw_text)
    });
  }
  return out;
}
function buildDocument(row,locations,chunks,opts={}){
  const canonical=canonicalState(row,locations,opts);
  const extraction=extractionState(row);
  const refs=referencesFor(row,chunks);
  const metadata=parseJson(row.metadata_json,{})||{};
  const sourceId="uyap-remote:"+row.remote_db_id;
  const contentReadable=extraction.status==="extracted"&&refs.some(x=>String(x.text||"").trim());
  return {
    sourceId,
    caseId:row.case_id,
    remoteDocumentDbId:row.remote_db_id,
    remoteDocumentId:row.remote_document_id,
    assetId:row.asset_id||null,
    name:row.remote_title||row.original_file_name||row.file_name||("UYAP Evrakı #"+row.remote_db_id),
    documentType:row.document_type||row.document_kind||row.classification||null,
    normalizedKind:normalizeKind(row),
    documentDate:row.document_date||null,
    uyap:{
      caseDbId:row.case_id,
      dosyaId:row.uyap_dosya_id||null,
      remoteDocumentId:row.remote_document_id||null,
      stableKey:row.stable_key||null,
      portalUrl:null,
      referenceStatus:row.uyap_dosya_id||row.remote_document_id?"identifier_available":"missing_identifier"
    },
    contentEndpoint:row.asset_id?"/api/assets/"+row.asset_id+"/content":null,
    canonical,
    downloadStatus:row.status||null,
    sourceContainer:row.source_container||metadata.derivedFrom||null,
    extraction:{
      ...extraction,
      readable:contentReadable,
      text:opts.includeText===false?null:(contentReadable?String(row.raw_text||""):null),
      references:refs
    },
    metadata
  };
}
function loadCaseReview(db,caseId,{verifyFiles=true,includeText=true}={}){
  caseId=Number(caseId);
  const c=db.prepare("SELECT id,office_file_id,court,court_file_no,case_type,status,client_name,uyap_dosya_id FROM cases WHERE id=?").get(caseId);
  if(!c)return null;
  const rows=db.prepare(`SELECT
      rd.id remote_db_id,rd.case_id,rd.remote_document_id,rd.stable_key,rd.remote_title,rd.document_type,rd.document_date,
      rd.original_file_name,rd.remote_hash,rd.local_asset_id asset_id,rd.staging_path,rd.filed_path,rd.status,rd.metadata_json,
      c.uyap_dosya_id,
      a.sha256,a.file_name,a.extension,a.classification,a.archive_path,a.archive_policy,a.source_container,
      da.document_kind,da.raw_text,da.extracted_json,da.sections_json,da.analysis_status,da.engine_version,da.error
    FROM uyap_remote_documents rd
    JOIN cases c ON c.id=rd.case_id
    LEFT JOIN local_assets a ON a.id=rd.local_asset_id
    LEFT JOIN document_analysis da ON da.asset_id=a.id
    WHERE rd.case_id=?
      AND (rd.local_asset_id IS NOT NULL OR rd.filed_path IS NOT NULL OR COALESCE(rd.metadata_json,'') LIKE '%"container":true%')
    ORDER BY COALESCE(rd.document_date,rd.downloaded_at,rd.first_seen_at) DESC,rd.id DESC`).all(caseId);
  const documents=[];
  for(const row of rows){
    const locations=row.asset_id?db.prepare("SELECT local_path,source_root,last_seen_at FROM asset_locations WHERE asset_id=? ORDER BY id").all(row.asset_id):[];
    const chunks=row.asset_id?db.prepare("SELECT chunk_no,heading,text,metadata_json FROM knowledge_chunks WHERE asset_id=? AND (case_id=? OR case_id IS NULL) ORDER BY chunk_no").all(row.asset_id,caseId):[];
    documents.push(buildDocument(row,locations,chunks,{verifyFiles,includeText}));
  }
  const readable=documents.filter(x=>x.extraction.readable&&x.canonical.verified!==false);
  const unreadable=documents.filter(x=>!x.extraction.readable).map(x=>({
    sourceId:x.sourceId,name:x.name,documentType:x.documentType,documentDate:x.documentDate,
    status:x.extraction.status,reason:x.extraction.error||x.canonical.reason||"unreadable"
  }));
  return {
    case:{id:c.id,officeFileId:c.office_file_id,court:c.court,courtFileNo:c.court_file_no,caseType:c.case_type,status:c.status,clientName:c.client_name,uyapDosyaId:c.uyap_dosya_id},
    documents,
    summary:{total:documents.length,readable:readable.length,unreadable:unreadable.length,verifiedCanonical:documents.filter(x=>x.canonical.verified===true).length},
    unreadable
  };
}
function draftingGroup(kind){
  if(kind==="duruşma_tutanağı")return "hearing_minutes";
  if(["dava_dilekçesi","cevap_dilekçesi","beyan_dilekçesi","savunma_dilekçesi","dilekçe","istinaf","temyiz"].includes(kind))return "pleadings";
  if(["bilirkişi_raporu","rapor"].includes(kind))return "expert_reports";
  if(["gerekçeli_karar","karar","tensip"].includes(kind))return "decisions";
  return "other";
}
function buildDraftingCorpus(review){
  if(!review)return null;
  const sourceDocuments=[];
  const sourceUnits=[];
  const unreadable=[];
  for(const doc of review.documents||[]){
    sourceDocuments.push({
      sourceId:doc.sourceId,
      name:doc.name,
      kind:doc.normalizedKind,
      documentType:doc.documentType,
      documentDate:doc.documentDate,
      remoteDocumentDbId:doc.remoteDocumentDbId,
      assetId:doc.assetId,
      canonicalPath:doc.canonical.path,
      verifiedSha256:doc.canonical.verified===true?doc.canonical.sha256:null,
      uyap:doc.uyap
    });
    if(!doc.extraction.readable){
      unreadable.push({sourceId:doc.sourceId,name:doc.name,status:doc.extraction.status,reason:doc.extraction.error||doc.canonical.reason||"unreadable"});
      continue;
    }
    for(const ref of doc.extraction.references||[]){
      if(!String(ref.text||"").trim())continue;
      sourceUnits.push({
        sourceRef:ref.sourceRef,
        sourceId:doc.sourceId,
        group:draftingGroup(doc.normalizedKind),
        documentKind:doc.normalizedKind,
        documentName:doc.name,
        documentDate:doc.documentDate,
        page:ref.page||null,
        heading:ref.heading||null,
        chunkNo:ref.chunkNo??null,
        text:ref.text
      });
    }
  }
  return {
    case:review.case,
    contractVersion:"case-document-review-v0.1",
    sourceDocuments,
    sourceUnits,
    unreadableDocuments:unreadable,
    rules:{
      neverMergeSourceIdentity:true,
      requireSourceRefForQuotedOrDerivedContent:true,
      pageReferenceWhenAvailable:true,
      doNotInferUnreadableContent:true
    }
  };
}

module.exports={
  runExtractor,
  normalizeKind,
  canonicalState,
  extractionState,
  referencesFor,
  buildDocument,
  loadCaseReview,
  buildDraftingCorpus
};
