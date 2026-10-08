"use strict";

const fs=require("fs");
const os=require("os");
const path=require("path");
const http=require("http");
const crypto=require("crypto");
const {DatabaseSync}=require("node:sqlite");
const adapter=require("../bridge/document_view_http");

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"bono-document-http-"));
const results=[];
const pass=(name,detail={})=>results.push({name,status:"pass",...detail});
const fail=(name,error,detail={})=>results.push({name,status:"fail",error:String(error),...detail});
function assert(name,cond,detail={}){cond?pass(name,detail):fail(name,"assertion failed",detail)}
function sha(file){return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}
function sql(db,q,...args){db.prepare(q).run(...args)}
async function req(base,url,opts={}){const r=await fetch(base+url,opts);const type=r.headers.get("content-type")||"";const body=type.includes("application/json")?await r.json():Buffer.from(await r.arrayBuffer());return {r,body}}

(async()=>{
let server=null,db=null;
try{
  const case1=path.join(tmp,"case1"),case2=path.join(tmp,"case2");
  fs.mkdirSync(case1,{recursive:true});fs.mkdirSync(case2,{recursive:true});
  const pdf=path.join(case1,"Gerekçeli Karar.pdf");
  const udf=path.join(case1,"Duruşma Zaptı.udf");
  const wrong=path.join(case2,"Gerekçeli Karar.pdf");
  const mutable=path.join(case1,"Değişebilir.pdf");
  fs.writeFileSync(pdf,Buffer.from("%PDF-1.4\nHTTP VERIFIED PDF FIXTURE\n"));
  fs.writeFileSync(udf,Buffer.from("PK\x03\x04HTTP-UDF-FIXTURE"));
  fs.writeFileSync(wrong,Buffer.from("%PDF-1.4\nOTHER CASE\n"));
  fs.writeFileSync(mutable,Buffer.from("%PDF-1.4\nORIGINAL MUTABLE\n"));

  db=new DatabaseSync(":memory:");
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
  sql(db,"INSERT INTO cases VALUES(1,7,'Kocaeli 7. Asliye Hukuk','2026/777','hukuk','active','Müvekkil A','UYAP-C1')");
  sql(db,"INSERT INTO cases VALUES(2,8,'Kocaeli 8. Asliye Hukuk','2026/888','hukuk','active','Müvekkil B','UYAP-C2')");

  const assets=[
    [1,sha(pdf),"Gerekçeli Karar.pdf",".pdf","karar",pdf,"keep_original",null],
    [2,sha(udf),"Duruşma Zaptı.udf",".udf","durusma_zapti",udf,"keep_udf",null],
    [3,sha(wrong),"Gerekçeli Karar.pdf",".pdf","karar",wrong,"keep_original",null],
    [4,sha(mutable),"Değişebilir.pdf",".pdf","belge",mutable,"keep_original",null]
  ];
  for(const a of assets)sql(db,"INSERT INTO local_assets VALUES(?,?,?,?,?,?,?,?)",...a);
  for(const a of assets)sql(db,"INSERT INTO asset_locations(asset_id,local_path,source_root,last_seen_at) VALUES(?,?,?,datetime('now'))",a[0],a[5],path.dirname(a[5]));

  const analyses=[
    [1,"gerekceli_karar","PDF karar metni","{}","[]","completed","fixture-pdf",null],
    [2,"durusma_zapti","UDF duruşma metni","{}",JSON.stringify([{heading:"AÇIKLAMALAR",startParagraph:2,text:"UDF duruşma metni"}]),"completed","fixture-udf",null],
    [3,"gerekceli_karar","OTHER CASE TEXT","{}","[]","completed","fixture",null],
    [4,"belge","MUTABLE TEXT","{}","[]","completed","fixture",null]
  ];
  for(const a of analyses)sql(db,"INSERT INTO document_analysis VALUES(?,?,?,?,?,?,?,?)",...a);
  sql(db,"INSERT INTO knowledge_chunks(asset_id,case_id,chunk_no,heading,text,metadata_json) VALUES(1,1,0,'Sayfa 1','PDF karar metni',?)",JSON.stringify({page:1}));
  sql(db,"INSERT INTO knowledge_chunks(asset_id,case_id,chunk_no,heading,text,metadata_json) VALUES(2,1,0,'AÇIKLAMALAR','UDF duruşma metni',?)",JSON.stringify({}));
  sql(db,"INSERT INTO knowledge_chunks(asset_id,case_id,chunk_no,heading,text,metadata_json) VALUES(3,2,0,'Sayfa 1','OTHER CASE TEXT',?)",JSON.stringify({page:1}));
  sql(db,"INSERT INTO knowledge_chunks(asset_id,case_id,chunk_no,heading,text,metadata_json) VALUES(4,1,0,'Sayfa 1','MUTABLE TEXT',?)",JSON.stringify({page:1}));

  const remotes=[
    [11,1,"RID-PDF","S-PDF","Gerekçeli Karar","Gerekçeli Karar","2026-10-01","Gerekçeli Karar.pdf",sha(pdf),1,null,pdf,"filed","{}","2026-10-01","2026-10-01"],
    [12,1,"RID-UDF","S-UDF","Duruşma Zaptı","Duruşma Zaptı","2026-10-02","Duruşma Zaptı.udf",sha(udf),2,null,udf,"filed","{}","2026-10-02","2026-10-02"],
    [21,2,"RID-OTHER","S-OTHER","Gerekçeli Karar","Gerekçeli Karar","2026-10-03","Gerekçeli Karar.pdf",sha(wrong),3,null,wrong,"filed","{}","2026-10-03","2026-10-03"],
    [14,1,"RID-MUT","S-MUT","Değişebilir Evrak","Diğer Evrak","2026-10-04","Değişebilir.pdf",sha(mutable),4,null,mutable,"filed","{}","2026-10-04","2026-10-04"]
  ];
  for(const r of remotes)sql(db,"INSERT INTO uyap_remote_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",...r);

  server=http.createServer((req,res)=>{
    if(adapter.handleDocumentViewRequest(req,res,db))return;
    res.writeHead(404,{"Content-Type":"application/json"});res.end(JSON.stringify({error:"not_found"}));
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve)});
  const addr=server.address(),base="http://127.0.0.1:"+addr.port;

  const view=await req(base,"/api/cases/1/documents/11/view");
  assert("http_view_200",view.r.status===200&&view.body.ok===true,{status:view.r.status,body:view.body});
  const d=view.body.document||{};
  assert("ui_c3f696e_contract_fields",
    Number(d.caseId)===1&&Number(d.remoteDocumentDbId)===11&&
    d.download&&typeof d.download.downloaded==="boolean"&&
    d.integrity&&typeof d.integrity.verified==="boolean"&&typeof d.integrity.exists==="boolean"&&
    d.readability&&typeof d.readability.readable==="boolean"&&"text" in d.readability&&"error" in d.readability&&"status" in d.readability&&
    d.viewer&&typeof d.viewer.openable==="boolean"&&typeof d.viewer.mode==="string",
    {document:d});
  assert("ui_case_identity_fields",d.case?.court==="Kocaeli 7. Asliye Hukuk"&&d.case?.courtFileNo==="2026/777"&&d.case?.officeFileId===7,{case:d.case});
  assert("pdf_ui_gate_true",d.viewer.openable===true&&d.integrity.verified===true&&d.integrity.exists===true&&d.viewer.mode==="pdf_inline",{viewer:d.viewer,integrity:d.integrity});

  const pdfResp=await req(base,"/api/cases/1/documents/11/content");
  assert("pdf_http_stream",pdfResp.r.status===200&&pdfResp.r.headers.get("content-type")==="application/pdf"&&pdfResp.body.equals(fs.readFileSync(pdf)),{status:pdfResp.r.status,headers:Object.fromEntries(pdfResp.r.headers.entries())});
  const pdfDisp=pdfResp.r.headers.get("content-disposition")||"";
  assert("pdf_inline_disposition_safe",pdfDisp.startsWith("inline;")&&pdfDisp.includes("filename*=UTF-8''")&&!/[\r\n]/.test(pdfDisp),{contentDisposition:pdfDisp});
  assert("pdf_stream_hash_header",pdfResp.r.headers.get("x-bono-verified-sha256")===sha(pdf));

  const udfView=await req(base,"/api/cases/1/documents/12/view");
  assert("udf_ui_text_mode",udfView.r.status===200&&udfView.body.document.viewer.mode==="udf_text"&&udfView.body.document.readability.readable===true&&udfView.body.document.readability.text.includes("UDF duruşma"),{document:udfView.body.document});
  const udfResp=await req(base,"/api/cases/1/documents/12/content");
  assert("udf_attachment_headers",udfResp.r.status===200&&udfResp.r.headers.get("content-type")==="application/octet-stream"&&(udfResp.r.headers.get("content-disposition")||"").startsWith("attachment;")&&udfResp.body.equals(fs.readFileSync(udf)),{headers:Object.fromEntries(udfResp.r.headers.entries())});

  const wrongView=await req(base,"/api/cases/1/documents/21/view");
  const wrongContent=await req(base,"/api/cases/1/documents/21/content");
  assert("wrong_case_hidden_http",wrongView.r.status===404&&wrongContent.r.status===404&&wrongView.body.error==="document_not_found_in_case"&&wrongContent.body.error==="document_not_found_in_case",{view:wrongView.body,content:wrongContent.body});

  const traversal=await req(base,"/api/cases/1/documents/%2e%2e/content");
  assert("encoded_path_traversal_not_matched",traversal.r.status===404,{status:traversal.r.status,body:traversal.body});

  const mutView=await req(base,"/api/cases/1/documents/14/view");
  assert("toctou_metadata_initially_verified",mutView.r.status===200&&mutView.body.document.integrity.verified===true);
  fs.writeFileSync(mutable,Buffer.from("%PDF-1.4\nCHANGED AFTER VIEW\n"));
  const mutContent=await req(base,"/api/cases/1/documents/14/content");
  assert("toctou_change_blocked_on_content_open",mutContent.r.status===412&&mutContent.body.error==="canonical_hash_not_verified"&&mutContent.body.reason==="sha256_mismatch",{status:mutContent.r.status,body:mutContent.body});

  const linkDir=path.join(tmp,"linked-case");
  let symlinkCreated=false;
  try{fs.symlinkSync(case2,linkDir,process.platform==="win32"?"junction":"dir");symlinkCreated=true}catch{}
  if(symlinkCreated){
    const linkedFile=path.join(linkDir,"Gerekçeli Karar.pdf");
    sql(db,"INSERT INTO local_assets VALUES(6,?,?,?,?,?,?,?)",sha(wrong),"Linked.pdf",".pdf","karar",linkedFile,"keep_original",null);
    sql(db,"INSERT INTO asset_locations(asset_id,local_path,source_root,last_seen_at) VALUES(6,?,?,datetime('now'))",linkedFile,path.dirname(linkedFile));
    sql(db,"INSERT INTO document_analysis VALUES(6,'karar','LINK TEXT','{}','[]','completed','fixture',NULL)");
    sql(db,"INSERT INTO knowledge_chunks(asset_id,case_id,chunk_no,heading,text,metadata_json) VALUES(6,1,0,'Sayfa 1','LINK TEXT',?)",JSON.stringify({page:1}));
    sql(db,"INSERT INTO uyap_remote_documents VALUES(16,1,'RID-LINK','S-LINK','Linked Evrak','Karar','2026-10-05','Linked.pdf',?,6,NULL,?,'filed','{}','2026-10-05','2026-10-05')",sha(wrong),linkedFile);
    const linkContent=await req(base,"/api/cases/1/documents/16/content");
    assert("symlink_component_rejected",linkContent.r.status===409&&linkContent.body.error==="canonical_symlink_rejected",{status:linkContent.r.status,body:linkContent.body});
  }else{
    pass("symlink_component_rejected",{skippedCreation:true,reason:"platform_did_not_allow_fixture_symlink"});
  }

  const unbound=path.join(case1,"Unbound.pdf");fs.writeFileSync(unbound,Buffer.from("%PDF-1.4\nUNBOUND\n"));
  sql(db,"INSERT INTO local_assets VALUES(7,?,?,?,?,?,?,?)",sha(unbound),"Unbound.pdf",".pdf","belge",unbound,"keep_original",null);
  sql(db,"INSERT INTO asset_locations(asset_id,local_path,source_root,last_seen_at) VALUES(7,?,?,datetime('now'))",pdf,case1);
  sql(db,"INSERT INTO document_analysis VALUES(7,'belge','UNBOUND','{}','[]','completed','fixture',NULL)");
  sql(db,"INSERT INTO uyap_remote_documents VALUES(17,1,'RID-UNBOUND','S-UNBOUND','Unbound','Belge','2026-10-06','Unbound.pdf',?,7,NULL,?,'filed','{}','2026-10-06','2026-10-06')",sha(unbound),unbound);
  const unboundResp=await req(base,"/api/cases/1/documents/17/content");
  assert("canonical_must_be_bound_to_asset_location",unboundResp.r.status===409&&unboundResp.body.error==="canonical_asset_location_mismatch",{status:unboundResp.r.status,body:unboundResp.body});

  const badMethod=await req(base,"/api/cases/1/documents/11/content",{method:"POST"});
  assert("non_get_not_handled_by_document_adapter",badMethod.r.status===404,{status:badMethod.r.status});

}catch(e){
  fail("selftest_unhandled",e.stack||e.message||e);
}finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(db)try{db.close()}catch{}
  try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}
}
const failed=results.filter(x=>x.status==="fail").length;
console.log(JSON.stringify({ok:failed===0,failed,tempCleaned:!fs.existsSync(tmp),results},null,2));
if(failed)process.exitCode=1;
})();