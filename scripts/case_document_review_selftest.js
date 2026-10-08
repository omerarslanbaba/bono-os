"use strict";

const fs=require("fs");
const os=require("os");
const path=require("path");
const crypto=require("crypto");
const {spawnSync}=require("child_process");
const {DatabaseSync}=require("node:sqlite");
const review=require("../bridge/case_document_review");

const ROOT=path.resolve(__dirname,"..");
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"bono-case-review-"));
const results=[];
const pass=(name,detail={})=>results.push({name,status:"pass",...detail});
const fail=(name,error,detail={})=>results.push({name,status:"fail",error:String(error),...detail});
function assert(name,cond,detail={}){cond?pass(name,detail):fail(name,"assertion failed",detail)}
function sha(file){return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}
function runPy(code,args=[]){
  const cp=spawnSync("py",["-3","-c",code,...args],{cwd:ROOT,encoding:"utf8",windowsHide:true,timeout:120000});
  if(cp.status!==0)throw new Error(cp.stderr||cp.stdout||"python failed");
  return cp;
}
function makePdf(file,text){
  const code=[
    "import sys",
    "from pypdf import PdfWriter",
    "from pypdf.generic import NameObject,DictionaryObject,StreamObject",
    "out,text=sys.argv[1],sys.argv[2]",
    "w=PdfWriter();p=w.add_blank_page(width=612,height=792)",
    "font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica'),NameObject('/Encoding'):NameObject('/WinAnsiEncoding')})",
    "font_ref=w._add_object(font)",
    "p[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font_ref})})",
    "safe=text.encode('latin-1','replace').replace(b'\\\\',b'\\\\\\\\').replace(b'(',b'\\\\(').replace(b')',b'\\\\)')",
    "stream=StreamObject();stream.set_data(b'BT /F1 12 Tf 72 720 Td ('+safe+b') Tj ET')",
    "p[NameObject('/Contents')]=w._add_object(stream)",
    "f=open(out,'wb');w.write(f);f.close()"
  ].join(";")
  runPy(code,[file,text]);
}
function makeBlankPdf(file){
  runPy("import sys;from pypdf import PdfWriter;w=PdfWriter();w.add_blank_page(width=612,height=792);f=open(sys.argv[1],'wb');w.write(f);f.close()",[file]);
}
function makeUdf(file,text){
  const input=path.join(tmp,"udf-input.json");
  fs.writeFileSync(input,JSON.stringify({markdown:text,styleProfile:{}}),"utf8");
  const cp=spawnSync("py",["-3",path.join(ROOT,"scripts","udf_engine.py"),"build",input,file],{cwd:ROOT,encoding:"utf8",windowsHide:true,timeout:120000});
  if(cp.status!==0)throw new Error(cp.stderr||cp.stdout||"udf build failed");
}
function sql(db,statement,...args){db.prepare(statement).run(...args)}

async function main(){
  try{
    const case1Dir=path.join(tmp,"case1"),case2Dir=path.join(tmp,"case2");
    fs.mkdirSync(case1Dir,{recursive:true});fs.mkdirSync(case2Dir,{recursive:true});
    const pdf1=path.join(case1Dir,"Beyan.pdf");
    const pdf2=path.join(case1Dir,"Beyan-2.pdf");
    const pdfWrong=path.join(case2Dir,"Beyan.pdf");
    const udf=path.join(case1Dir,"Duruşma Tutanağı.udf");
    const blank=path.join(case1Dir,"Tarama.pdf");
    const corrupt=path.join(case1Dir,"Bozuk.pdf");
    makePdf(pdf1,"PDF FIXTURE METNI DOSYA BIR SAYFA BIR");
    makePdf(pdf2,"PDF IKINCI EVRAK AYNI ISIM FARKLI ICERIK");
    makePdf(pdfWrong,"WRONG CASE SECRET CONTENT");
    makeBlankPdf(blank);
    makeUdf(udf,"DURUŞMA ZAPTI\n\nAÇIKLAMALAR\nUDF FIXTURE METNI VE TANIK BEYANI\n\nSONUÇ VE İSTEM\nTalep sonucu.");
    fs.writeFileSync(corrupt,Buffer.from("%PDF-corrupt"));

    const pdfExtract=await review.runExtractor(pdf1);
    const pdf2Extract=await review.runExtractor(pdf2);
    const udfExtract=await review.runExtractor(udf);
    const blankExtract=await review.runExtractor(blank);
    const corruptExtract=await review.runExtractor(corrupt);

    assert("pdf_text_extraction",pdfExtract.status==="extracted"&&pdfExtract.rawText.includes("PDF FIXTURE METNI")&&pdfExtract.references.some(x=>x.page===1),{status:pdfExtract.status,refs:pdfExtract.references.length});
    assert("udf_text_extraction",udfExtract.status==="extracted"&&udfExtract.rawText.includes("UDF FIXTURE METNI")&&udfExtract.references.length>0,{status:udfExtract.status,refs:udfExtract.references.length,kind:udfExtract.documentKind});
    assert("scanned_or_blank_pdf_is_not_guessed",blankExtract.status==="no_text"&&blankExtract.reason==="no_embedded_text_or_scan_requires_ocr",blankExtract);
    assert("corrupt_pdf_reported_failed",corruptExtract.status==="failed"&&corruptExtract.reason==="pdf_parse_failed",{status:corruptExtract.status,reason:corruptExtract.reason});

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
    sql(db,"INSERT INTO cases VALUES(1,10,'Kocaeli 1. Asliye Hukuk','2026/100','hukuk','active','Müvekkil A','UYAP-CASE-1')");
    sql(db,"INSERT INTO cases VALUES(2,20,'Kocaeli 2. Asliye Hukuk','2026/200','hukuk','active','Müvekkil B','UYAP-CASE-2')");

    const assets=[
      [1,sha(pdf1),"Beyan.pdf",".pdf","dilekce",pdf1,"keep_original",null],
      [2,sha(pdf2),"Beyan.pdf",".pdf","dilekce",pdf2,"keep_original",null],
      [3,sha(udf),"Duruşma Tutanağı.udf",".udf","durusma_zapti",udf,"keep_udf",null],
      [4,sha(corrupt),"Bozuk.pdf",".pdf","belge",corrupt,"keep_original",null],
      [5,sha(pdfWrong),"Beyan.pdf",".pdf","dilekce",pdfWrong,"keep_original",null]
    ];
    for(const a of assets)sql(db,"INSERT INTO local_assets VALUES(?,?,?,?,?,?,?,?)",...a);
    for(const a of assets)sql(db,"INSERT INTO asset_locations(asset_id,local_path,source_root,last_seen_at) VALUES(?,?,?,datetime('now'))",a[0],a[5],path.dirname(a[5]));

    const analysis=[
      [1,"beyan_dilekcesi",pdfExtract.rawText,"{}",JSON.stringify([]),"completed",pdfExtract.engine,null],
      [2,"beyan_dilekcesi",pdf2Extract.rawText,"{}",JSON.stringify([]),"completed",pdf2Extract.engine,null],
      [3,"durusma_zapti",udfExtract.rawText,"{}",JSON.stringify(udfExtract.sections||[]),"completed",udfExtract.engine,null],
      [4,"belge","","{}","[]","failed",corruptExtract.engine,corruptExtract.error||"pdf_parse_failed"],
      [5,"beyan_dilekcesi","WRONG CASE SECRET CONTENT","{}","[]","completed","fixture",null]
    ];
    for(const a of analysis)sql(db,"INSERT INTO document_analysis VALUES(?,?,?,?,?,?,?,?)",...a);

    sql(db,"INSERT INTO knowledge_chunks(asset_id,case_id,chunk_no,heading,text,metadata_json) VALUES(1,1,0,'Sayfa 1',?,?)",pdfExtract.rawText,JSON.stringify({page:1,fileName:"Beyan.pdf"}));
    sql(db,"INSERT INTO knowledge_chunks(asset_id,case_id,chunk_no,heading,text,metadata_json) VALUES(2,1,0,'Sayfa 1',?,?)",pdf2Extract.rawText,JSON.stringify({page:1,fileName:"Beyan.pdf"}));
    sql(db,"INSERT INTO knowledge_chunks(asset_id,case_id,chunk_no,heading,text,metadata_json) VALUES(3,1,0,'AÇIKLAMALAR',?,?)","UDF FIXTURE METNI VE TANIK BEYANI",JSON.stringify({fileName:"Duruşma Tutanağı.udf"}));
    sql(db,"INSERT INTO knowledge_chunks(asset_id,case_id,chunk_no,heading,text,metadata_json) VALUES(5,2,0,'Sayfa 1','WRONG CASE SECRET CONTENT',?)",JSON.stringify({page:1}));

    const remotes=[
      [11,1,"RID-11","S-11","Beyan Dilekçesi","Beyan Dilekçesi","2026-10-01","Beyan.pdf",sha(pdf1),1,null,pdf1,"filed","{}", "2026-10-01","2026-10-01"],
      [12,1,"RID-12","S-12","Beyan Dilekçesi","Beyan Dilekçesi","2026-10-02","Beyan.pdf",sha(pdf2),2,null,pdf2,"filed","{}", "2026-10-02","2026-10-02"],
      [13,1,"RID-13","S-13","Duruşma Zaptı","Duruşma Zaptı","2026-10-03","Duruşma Tutanağı.udf",sha(udf),3,null,udf,"filed","{}", "2026-10-03","2026-10-03"],
      [14,1,"RID-14","S-14","Bozuk Evrak","Diğer Evrak","2026-10-04","Bozuk.pdf",sha(corrupt),4,null,corrupt,"filed","{}", "2026-10-04","2026-10-04"],
      [21,2,"RID-21","S-21","Beyan Dilekçesi","Beyan Dilekçesi","2026-10-05","Beyan.pdf",sha(pdfWrong),5,null,pdfWrong,"filed","{}", "2026-10-05","2026-10-05"]
    ];
    for(const r of remotes)sql(db,"INSERT INTO uyap_remote_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",...r);

    const caseReview=review.loadCaseReview(db,1,{verifyFiles:true,includeText:true});
    assert("case_review_contains_only_requested_case",caseReview.documents.length===4&&caseReview.documents.every(x=>x.caseId===1),{count:caseReview.documents.length,ids:caseReview.documents.map(x=>x.remoteDocumentDbId)});
    assert("same_name_different_documents_remain_distinct",caseReview.documents.filter(x=>x.name==="Beyan Dilekçesi").length===2&&new Set(caseReview.documents.filter(x=>x.name==="Beyan Dilekçesi").map(x=>x.sourceId)).size===2,{sourceIds:caseReview.documents.filter(x=>x.name==="Beyan Dilekçesi").map(x=>x.sourceId)});
    assert("document_metadata_matches_uyap_source",caseReview.documents.some(x=>x.remoteDocumentDbId===11&&x.documentDate==="2026-10-01"&&x.uyap.dosyaId==="UYAP-CASE-1"&&x.uyap.remoteDocumentId==="RID-11"));
    assert("canonical_hash_is_verified",caseReview.documents.filter(x=>x.remoteDocumentDbId!==14).every(x=>x.canonical.verified===true),{canonical:caseReview.documents.map(x=>({id:x.remoteDocumentDbId,verified:x.canonical.verified}))});
    assert("corrupt_document_remains_reported_unreadable",caseReview.unreadable.some(x=>x.sourceId==="uyap-remote:14"&&x.status==="failed"),{unreadable:caseReview.unreadable});
    const pdfDoc=caseReview.documents.find(x=>x.remoteDocumentDbId===11);
    const udfDoc=caseReview.documents.find(x=>x.remoteDocumentDbId===13);
    assert("pdf_page_reference_preserved",pdfDoc.extraction.references.some(x=>x.page===1&&x.text.includes("PDF FIXTURE METNI")),{refs:pdfDoc.extraction.references});
    assert("udf_section_or_chunk_reference_preserved",udfDoc.extraction.references.some(x=>x.heading==="AÇIKLAMALAR"&&x.text.includes("UDF FIXTURE METNI")),{refs:udfDoc.extraction.references});

    const corpus=review.buildDraftingCorpus(caseReview);
    assert("drafting_corpus_keeps_source_identity",corpus.sourceUnits.every(x=>x.sourceRef&&x.sourceId)&&new Set(corpus.sourceDocuments.map(x=>x.sourceId)).size===corpus.sourceDocuments.length,{units:corpus.sourceUnits.length});
    assert("wrong_case_content_is_excluded",!JSON.stringify(corpus).includes("WRONG CASE SECRET CONTENT"));
    assert("unreadable_content_is_not_inferred",corpus.unreadableDocuments.some(x=>x.sourceId==="uyap-remote:14")&&!corpus.sourceUnits.some(x=>x.sourceId==="uyap-remote:14"));
    assert("petition_groups_are_structured",corpus.sourceUnits.some(x=>x.group==="pleadings")&&corpus.sourceUnits.some(x=>x.group==="hearing_minutes"),{groups:[...new Set(corpus.sourceUnits.map(x=>x.group))]});

    db.close();
  }catch(e){
    fail("selftest_unhandled",e.stack||e.message||e);
  }finally{
    try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}
  }
  const failed=results.filter(x=>x.status==="fail").length;
  console.log(JSON.stringify({ok:failed===0,failed,tempCleaned:!fs.existsSync(tmp),results},null,2));
  if(failed)process.exitCode=1;
}
main();
