const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const net=require("node:net");
const crypto=require("node:crypto");
const {spawn,spawnSync}=require("node:child_process");
function must(v,m){if(!v)throw new Error(m)}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function sha(buf){return crypto.createHash("sha256").update(buf).digest("hex")}
async function freePort(){return await new Promise((resolve,reject)=>{const s=net.createServer();s.on("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p))})})}
async function jsonReq(base,url){const r=await fetch(base+url);const t=await r.text();let b;try{b=JSON.parse(t)}catch{b=t}return {r,b}}

(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"bono-archive-route-"));
 const dbPath=path.join(root,"fixture.db"),port=await freePort();
 const pdfPath=path.join(root,"Gerekçeli Karar.pdf"),udfPath=path.join(root,"Duruşma Örneği.udf");
 const pdf=Buffer.from("%PDF-1.4\nBONO fixture PDF\n%%EOF\n"),udf=Buffer.from("BONO UDF fixture bytes");
 fs.writeFileSync(pdfPath,pdf);fs.writeFileSync(udfPath,udf);
 const env={...process.env,BONO_DB_PATH:dbPath,BONO_PORT:String(port),BONO_DISABLE_WORKER:"1",USERPROFILE:root,FIX_ROOT:root,FIX_PDF:pdfPath,FIX_UDF:udfPath,FIX_PDF_SHA:sha(pdf),FIX_UDF_SHA:sha(udf),FIX_PDF_SIZE:String(pdf.length),FIX_UDF_SIZE:String(udf.length)};
 const seed=[
  "const db=require('./bridge/db');",
  "const e=process.env;",
  "db.prepare('insert into cases(id,external_id,court,court_file_no,case_type,status,client_name) values(?,?,?,?,?,?,?)').run(1,'fixture:case:1','Eskişehir Cumhuriyet Başsavcılığı','2026/12345','Soruşturma','open','Fixture Müvekkil');",
  "db.prepare('insert into cases(id,external_id,court,court_file_no,case_type,status,client_name) values(?,?,?,?,?,?,?)').run(2,'fixture:case:2','Eskişehir 1. Asliye Ceza Mahkemesi','2026/77','Ceza','open','Başka Müvekkil');",
  "db.prepare('insert into local_assets(id,sha256,file_name,extension,size_bytes,classification,archive_path,archive_policy,source_container) values(?,?,?,?,?,?,?,?,?)').run(1001,e.FIX_PDF_SHA,'Gerekçeli Karar.pdf','.pdf',Number(e.FIX_PDF_SIZE),'legal',e.FIX_PDF,'canonical','uyap');",
  "db.prepare('insert into local_assets(id,sha256,file_name,extension,size_bytes,classification,archive_path,archive_policy,source_container) values(?,?,?,?,?,?,?,?,?)').run(1002,e.FIX_UDF_SHA,'Duruşma Örneği.udf','.udf',Number(e.FIX_UDF_SIZE),'legal',e.FIX_UDF,'canonical','uyap');",
  "db.prepare('insert into asset_locations(asset_id,local_path,source_root) values(?,?,?)').run(1001,e.FIX_PDF,e.FIX_ROOT);",
  "db.prepare('insert into asset_locations(asset_id,local_path,source_root) values(?,?,?)').run(1002,e.FIX_UDF,e.FIX_ROOT);",
  "db.prepare('insert into uyap_remote_documents(id,case_id,remote_document_id,remote_title,document_type,document_date,original_file_name,remote_hash,local_asset_id,filed_path,status) values(?,?,?,?,?,?,?,?,?,?,?)').run(201,1,'R-PDF','Gerekçeli Karar','Gerekçeli Karar','2026-10-08','Gerekçeli Karar.pdf',e.FIX_PDF_SHA,1001,e.FIX_PDF,'filed');",
  "db.prepare('insert into uyap_remote_documents(id,case_id,remote_document_id,remote_title,document_type,document_date,original_file_name,remote_hash,local_asset_id,filed_path,status) values(?,?,?,?,?,?,?,?,?,?,?)').run(202,1,'R-UDF','Duruşma Tutanağı','Duruşma Zaptı','2026-10-08','Duruşma Örneği.udf',e.FIX_UDF_SHA,1002,e.FIX_UDF,'filed');",
  "db.prepare('insert into document_analysis(asset_id,document_kind,raw_text,analysis_status,engine_version) values(?,?,?,?,?)').run(1002,'duruşma_tutanağı','Fixture UDF okunabilir metni','completed','fixture');",
  "try{db.close()}catch{}"
 ].join("\n");
 const seeded=spawnSync(process.execPath,["-e",seed],{cwd:process.cwd(),env,encoding:"utf8"});
 if(seeded.status!==0)throw new Error("archive fixture seed failed: "+seeded.stderr);
 const server=spawn(process.execPath,["bridge/server.js"],{cwd:process.cwd(),env,stdio:["ignore","pipe","pipe"]});let out="",err="";server.stdout.on("data",d=>out+=d);server.stderr.on("data",d=>err+=d);
 const base="http://127.0.0.1:"+port;
 try{
  let healthy=false;for(let i=0;i<80;i++){try{if((await fetch(base+"/health")).ok){healthy=true;break}}catch{}if(server.exitCode!=null)break;await sleep(100)}must(healthy,"fixture Core failed\n"+out+"\n"+err);
  const view=await jsonReq(base,"/api/cases/1/documents/201/view");
  must(view.r.status===200&&view.b.ok===true,"PDF view failed");
  must(view.b.document.caseId===1&&view.b.document.remoteDocumentDbId===201,"PDF ownership metadata wrong");
  must(view.b.document.integrity.verified===true&&view.b.document.integrity.streamSafe===true,"PDF integrity not verified");
  must(view.b.document.viewer.openable===true&&view.b.document.viewer.mode==="pdf_inline","PDF viewer not inline/openable");
  const content=await fetch(base+"/api/cases/1/documents/201/content");const bytes=Buffer.from(await content.arrayBuffer());
  must(content.status===200&&content.headers.get("content-type")==="application/pdf","PDF stream response wrong");
  must(content.headers.get("x-bono-verified-sha256")===sha(pdf),"verified SHA header wrong");
  must(Buffer.compare(bytes,pdf)===0,"PDF streamed bytes differ");
  const wrong=await jsonReq(base,"/api/cases/2/documents/201/view");
  must(wrong.r.status===404&&wrong.b.error==="document_not_found_in_case","wrong-case access was not rejected");
  const wrongContent=await jsonReq(base,"/api/cases/2/documents/201/content");
  must(wrongContent.r.status===404&&wrongContent.b.error==="document_not_found_in_case","wrong-case content access was not rejected");
  const udfView=await jsonReq(base,"/api/cases/1/documents/202/view");
  const udfMode=udfView.b?.document?.viewer?.mode;
  must(udfView.r.status===200&&udfView.b.document.viewer.openable===true&&["udf_text","udf_download_only"].includes(udfMode),"UDF safe viewer mode missing: "+JSON.stringify(udfView.b));
  if(udfMode==="udf_text"){
    must(udfView.b.document.readability.readable===true&&String(udfView.b.document.readability.text||"").includes("Fixture UDF"),"UDF text mode requires extracted text");
  }else{
    must(udfView.b.document.readability.readable===false,"UDF download-only mode must report unreadable text");
  }
  const udfContent=await fetch(base+"/api/cases/1/documents/202/content");const udfBytes=Buffer.from(await udfContent.arrayBuffer());
  must(udfContent.status===200&&String(udfContent.headers.get("content-disposition")||"").startsWith("attachment;"),"UDF content must be attachment");
  must(String(udfContent.headers.get("content-disposition")||"").includes("filename*=UTF-8"),"UTF-8 filename disposition missing");
  must(Buffer.compare(udfBytes,udf)===0,"UDF streamed bytes differ");
  fs.appendFileSync(pdfPath,"TAMPER");
  const tampered=await jsonReq(base,"/api/cases/1/documents/201/content");
  must(tampered.r.status===412&&tampered.b.error==="canonical_hash_not_verified","tampered content was not rejected at stream time");
  console.log(JSON.stringify({ok:true,coreRouteIntegration:true,pdfInline:true,udfViewerMode:udfMode,caseOwnership:true,wrongCaseRejected:true,shaVerified:true,toctouTamperRejected:true,utf8Disposition:true}));
 }finally{if(server.exitCode==null)server.kill();await sleep(100);try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
})().catch(e=>{console.error(e);process.exit(1)});
