"use strict";

const fs=require("fs");
const os=require("os");
const path=require("path");
const crypto=require("crypto");
const {DatabaseSync}=require("node:sqlite");
const service=require("../bridge/document_view_service");

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"bono-document-view-"));
const results=[];
const pass=(name,detail={})=>results.push({name,status:"pass",...detail});
const fail=(name,error,detail={})=>results.push({name,status:"fail",error:String(error),...detail});
function assert(name,cond,detail={}){cond?pass(name,detail):fail(name,"assertion failed",detail)}
function sha(file){return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}
function sql(db,q,...args){db.prepare(q).run(...args)}

try{
  const case1=path.join(tmp,"case1"),case2=path.join(tmp,"case2");
  fs.mkdirSync(case1,{recursive:true});fs.mkdirSync(case2,{recursive:true});
  const pdf=path.join(case1,"Karar.pdf");
  const udf=path.join(case1,"Duruşma.udf");
  const broken=path.join(case1,"Bozuk.pdf");
  const badHash=path.join(case1,"HashSorunu.pdf");
  const wrongCase=path.join(case2,"Karar.pdf");
  fs.writeFileSync(pdf,Buffer.from("%PDF-1.4\nBONO VERIFIED PDF FIXTURE\n"));
  fs.writeFileSync(udf,Buffer.from("PK\x03\x04UDF-FIXTURE"));
  fs.writeFileSync(broken,Buffer.from("%PDF-broken"));
  fs.writeFileSync(badHash,Buffer.from("%PDF-1.4\nACTUAL CONTENT\n"));
  fs.writeFileSync(wrongCase,Buffer.from("%PDF-1.4\nOTHER CASE\n"));

  const db=new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE cases(id INTEGER PRIMARY KEY,office_file_id INTEGER,court TEXT,court_file_no TEXT,case_type TEXT,status TEXT,client_name TEXT,uyap_dosya_id TEXT);
    CREATE TABLE local_assets(id INTEGER PRIMARY KEY,sha256 TEXT,file_name TEXT,extension TEXT,classification TEXT,archive_path TEXT,archive_policy TEXT,source_container TEXT);
    CREATE TABLE asset_locations(id INTEGER PRIMARY KEY,asset_id INTEGER,local_path TEXT,source_root TEXT,last_seen_at TEXT);
    CREATE TABLE document_analysis(asset_id INTEGER PRIMARY KEY,document_kind TEXT,raw_text TEXT,extracted_json TEXT,sections_json TEXT,analysis_status TEXT,engine_version TEXT,error TEXT);
    CREATE TABLE knowledge_chunks(id INTEGER PRIMARY KEY,asset_id INTEGER,case_id INTEGER,chunk_no INTEGER,heading TEXT,text TEXT,metadata_json TEXT);
    CREATE TABLE uyap_remote_documents(
      id INTEGER PRIMARY KEY,case_id INTEGER,remote_document_id TEXT,stable_key TEXT,remote_title TEXT,document_type TEXT,document_date TEXT,
      original_file_name TEXT,remote_hash TEXT,local_asset_id INTEGER,staging_path TEXT,filed_path TEXT,status TEXT,metadata_json TEXT,
      downloaded_at TEXT,first_seen_at TEXT
    );
  `);
  sql(db,"INSERT INTO cases VALUES(1,10,'Kocaeli 1. Asliye Hukuk','2026/100','hukuk','active','Müvekkil A','UYAP-C1')");
  sql(db,"INSERT INTO cases VALUES(2,20,'Kocaeli 2. Asliye Hukuk','2026/200','hukuk','active','Müvekkil B','UYAP-C2')");

  const assets=[
    [1,sha(pdf),"Karar.pdf",".pdf","karar",pdf,"keep_original",null],
    [2,sha(udf),"Duruşma.udf",".udf","durusma_zapti",udf,"keep_udf",null],
    [3,sha(broken),"Bozuk.pdf",".pdf","belge",broken,"keep_original",null],
    [4,"0".repeat(64),"HashSorunu.pdf",".pdf","belge",badHash,"keep_original",null],
    [5,sha(wrongCase),"Karar.pdf",".pdf","karar",wrongCase,"keep_original",null]
  ];
  for(const a of assets)sql(db,"INSERT INTO local_assets VALUES(?,?,?,?,?,?,?,?)",...a);
  for(const a of assets)sql(db,"INSERT INTO asset_locations(asset_id,local_path,source_root,last_seen_at) VALUES(?,?,?,datetime('now'))",a[0],a[5],path.dirname(a[5]));

  const analyses=[
    [1,"gerekceli_karar","PDF karar metni fixture","{}","[]","completed","fixture-pdf",null],
    [2,"durusma_zapti","UDF duruşma metni fixture","{}",JSON.stringify([{heading:"AÇIKLAMALAR",startParagraph:3,text:"UDF duruşma metni fixture"}]),"completed","fixture-udf",null],
    [3,"belge","","{}","[]","failed","fixture","pdf_parse_failed"],
    [4,"belge","HASH MISMATCH CONTENT","{}","[]","completed","fixture",null],
    [5,"gerekceli_karar","OTHER CASE TEXT","{}","[]","completed","fixture",null]
  ];
  for(const a of analyses)sql(db,"INSERT INTO document_analysis VALUES(?,?,?,?,?,?,?,?)",...a);

  sql(db,"INSERT INTO knowledge_chunks(asset_id,case_id,chunk_no,heading,text,metadata_json) VALUES(1,1,0,'Sayfa 1','PDF karar metni fixture',?)",JSON.stringify({page:1}));
  sql(db,"INSERT INTO knowledge_chunks(asset_id,case_id,chunk_no,heading,text,metadata_json) VALUES(2,1,0,'AÇIKLAMALAR','UDF duruşma metni fixture',?)",JSON.stringify({}));
  sql(db,"INSERT INTO knowledge_chunks(asset_id,case_id,chunk_no,heading,text,metadata_json) VALUES(4,1,0,'Sayfa 1','HASH MISMATCH CONTENT',?)",JSON.stringify({page:1}));
  sql(db,"INSERT INTO knowledge_chunks(asset_id,case_id,chunk_no,heading,text,metadata_json) VALUES(5,2,0,'Sayfa 1','OTHER CASE TEXT',?)",JSON.stringify({page:1}));

  const remotes=[
    [11,1,"RID-PDF","S-PDF","Gerekçeli Karar","Gerekçeli Karar","2026-10-01","Karar.pdf",sha(pdf),1,null,pdf,"filed","{}","2026-10-01","2026-10-01"],
    [12,1,"RID-UDF","S-UDF","Duruşma Zaptı","Duruşma Zaptı","2026-10-02","Duruşma.udf",sha(udf),2,null,udf,"filed","{}","2026-10-02","2026-10-02"],
    [13,1,"RID-BROKEN","S-BROKEN","Bozuk Evrak","Diğer Evrak","2026-10-03","Bozuk.pdf",sha(broken),3,null,broken,"filed","{}","2026-10-03","2026-10-03"],
    [14,1,"RID-HASH","S-HASH","Hash Sorunlu Evrak","Diğer Evrak","2026-10-04","HashSorunu.pdf","0".repeat(64),4,null,badHash,"filed","{}","2026-10-04","2026-10-04"],
    [15,1,"RID-MISSING","S-MISSING","Henüz Canonical Yok","Beyan Dilekçesi","2026-10-05","Eksik.pdf",null,null,path.join(tmp,"staging","Eksik.pdf"),null,"download_queued","{}","2026-10-05","2026-10-05"],
    [21,2,"RID-OTHER","S-OTHER","Gerekçeli Karar","Gerekçeli Karar","2026-10-06","Karar.pdf",sha(wrongCase),5,null,wrongCase,"filed","{}","2026-10-06","2026-10-06"]
  ];
  for(const r of remotes)sql(db,"INSERT INTO uyap_remote_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",...r);

  const pdfView=service.getDocumentView(db,1,11);
  assert("pdf_view_metadata_is_case_scoped",pdfView.ok&&pdfView.document.caseId===1&&pdfView.document.remoteDocumentDbId===11&&pdfView.document.name==="Gerekçeli Karar"&&pdfView.document.documentDate==="2026-10-01",{document:pdfView.document});
  assert("pdf_download_hash_readability_are_separate",pdfView.document.download.downloaded===true&&pdfView.document.integrity.verified===true&&pdfView.document.readability.readable===true,{download:pdfView.document.download,integrity:pdfView.document.integrity,readability:pdfView.document.readability});
  assert("pdf_viewer_is_inline",pdfView.document.viewer.mode==="pdf_inline"&&pdfView.document.viewer.contentType==="application/pdf"&&pdfView.document.viewer.openable===true,pdfView.document.viewer);
  const pdfAuth=service.authorizeDocumentContent(db,1,11);
  assert("verified_pdf_content_is_authorized",pdfAuth.ok&&pdfAuth.path===pdf&&pdfAuth.contentType==="application/pdf"&&pdfAuth.disposition==="inline",pdfAuth);

  const udfView=service.getDocumentView(db,1,12);
  assert("udf_view_uses_text_mode",udfView.ok&&udfView.document.viewer.mode==="udf_text"&&udfView.document.readability.text.includes("UDF duruşma metni")&&udfView.document.viewer.disposition==="attachment",{viewer:udfView.document.viewer,readability:udfView.document.readability});
  assert("udf_reference_has_section_or_chunk",udfView.document.readability.references.some(x=>x.heading==="AÇIKLAMALAR"&&x.text.includes("UDF duruşma")),udfView.document.readability.references);
  const udfAuth=service.authorizeDocumentContent(db,1,12);
  assert("verified_udf_raw_file_can_be_downloaded",udfAuth.ok&&udfAuth.contentType==="application/octet-stream"&&udfAuth.disposition==="attachment",udfAuth);

  const wrongCaseView=service.getDocumentView(db,1,21);
  assert("other_case_document_is_hidden",wrongCaseView.ok===false&&wrongCaseView.statusCode===404&&wrongCaseView.error==="document_not_found_in_case",wrongCaseView);
  const wrongCaseAuth=service.authorizeDocumentContent(db,1,21);
  assert("other_case_content_is_not_authorized",wrongCaseAuth.ok===false&&wrongCaseAuth.statusCode===404,wrongCaseAuth);

  const brokenView=service.getDocumentView(db,1,13);
  assert("broken_document_is_explicitly_unreadable",brokenView.ok&&brokenView.document.download.downloaded===true&&brokenView.document.integrity.verified===true&&brokenView.document.readability.status==="failed"&&brokenView.document.readability.readable===false,{download:brokenView.document.download,integrity:brokenView.document.integrity,readability:brokenView.document.readability});
  assert("broken_but_verified_pdf_can_still_open_as_file",brokenView.document.viewer.openable===true&&brokenView.document.viewer.mode==="pdf_inline",brokenView.document.viewer);

  const hashView=service.getDocumentView(db,1,14);
  assert("hash_mismatch_is_visible_separately",hashView.ok&&hashView.document.download.downloaded===true&&hashView.document.integrity.verified===false&&hashView.document.integrity.reason==="sha256_mismatch"&&hashView.document.readability.readable===true,{download:hashView.document.download,integrity:hashView.document.integrity,readability:hashView.document.readability});
  const hashAuth=service.authorizeDocumentContent(db,1,14);
  assert("hash_mismatch_blocks_content_stream",hashAuth.ok===false&&hashAuth.statusCode===412&&hashAuth.error==="canonical_hash_not_verified",hashAuth);

  const missingView=service.getDocumentView(db,1,15);
  assert("not_downloaded_or_not_canonical_is_reported",missingView.ok&&missingView.document.integrity.exists===false&&missingView.document.viewer.openable===false,{download:missingView.document.download,integrity:missingView.document.integrity,viewer:missingView.document.viewer});
  const missingAuth=service.authorizeDocumentContent(db,1,15);
  assert("missing_canonical_blocks_content_stream",missingAuth.ok===false&&[409,412].includes(missingAuth.statusCode),missingAuth);

  assert("view_endpoint_is_case_scoped",pdfView.document.endpoints.metadata==="/api/cases/1/documents/11/view"&&pdfView.document.endpoints.content==="/api/cases/1/documents/11/content",pdfView.document.endpoints);

  db.close();
}catch(e){
  fail("selftest_unhandled",e.stack||e.message||e);
}finally{
  try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}
}

const failed=results.filter(x=>x.status==="fail").length;
console.log(JSON.stringify({ok:failed===0,failed,tempCleaned:!fs.existsSync(tmp),results},null,2));
if(failed)process.exitCode=1;
