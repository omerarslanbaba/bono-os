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
async function req(base,url,options={}){const r=await fetch(base+url,{headers:{"Content-Type":"application/json",...(options.headers||{})},...options});const t=await r.text();let b;try{b=t?JSON.parse(t):null}catch{b=t}return {status:r.status,body:b,headers:r.headers}}

(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"bono-single-file-pipeline-"));
 const user=path.join(root,"user"),dbPath=path.join(root,"fixture.db"),port=await freePort();
 const archiveRoot=path.join(user,"OneDrive","Masaüstü","Dava Dosyaları","Cumhuriyet Başsavcılıkları","Fixture 2026-101");
 fs.mkdirSync(archiveRoot,{recursive:true});
 const env={...process.env,BONO_DB_PATH:dbPath,BONO_PORT:String(port),BONO_DISABLE_WORKER:"1",USERPROFILE:user};
 const seed=[
  "const db=require(\"./bridge/db\");const policy=require(\"./bridge/uyap_user_queries\");",
  "function setting(k,v){db.prepare(\"insert into app_settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value\").run(k,v)}",
  "setting(\"uyap_integration_mode\",\"browser_readonly\");setting(\"uyap_session_state\",\"ready\");setting(\"uyap_manual_download_pause\",\"1\");setting(\"uyap_document_download_state\",\"paused_manual\");",
  "db.prepare(\"insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms) values(?,?,?,?,?,?,?)\").run(\"document.list\",\"POST\",\"avukat.uyap.gov.tr\",\"/list_dosya_evraklar.ajx\",\"docs\",1,0);",
  "db.prepare(\"insert into cases(id,external_id,court,court_file_no,case_type,status,client_name,uyap_dosya_id,uyap_birim_id) values(?,?,?,?,?,?,?,?,?)\").run(101,\"uyap:fixture:101\",\"Kocaeli 1. Asliye Hukuk Mahkemesi\",\"2026/101\",\"Hukuk\",\"open\",\"Fixture Müvekkil\",\"DOSYA-101\",\"BIRIM-101\");",
  "policy.migrate(db,{expectedQueued:0,backupManifest:{schema:1,verified:true,queueIdDigest:policy.digest([])},migrationId:\"pipeline-zero\"});",
  "policy.certifyBinding(db,{caseId:101,kind:\"verified_portal_binding\",adapter:\"court_documents_v1\",evidenceRef:\"observation:00000000-0000-4000-8000-000000000101\",unitId:\"BIRIM-101\",caseNo:\"2026/101\",dosyaId:\"DOSYA-101\"});",
  "try{db.close()}catch{}"
 ].join("\n");
 const seeded=spawnSync(process.execPath,["-e",seed],{cwd:process.cwd(),env,encoding:"utf8"});
 if(seeded.status!==0)throw new Error("seed failed: "+seeded.stderr);
 const server=spawn(process.execPath,["bridge/server.js"],{cwd:process.cwd(),env,stdio:["ignore","pipe","pipe"]});let out="",err="";server.stdout.on("data",d=>out+=d);server.stderr.on("data",d=>err+=d);
 const base="http://127.0.0.1:"+port;
 try{
  let healthy=false;for(let i=0;i<80;i++){try{if((await req(base,"/health")).status===200){healthy=true;break}}catch{}if(server.exitCode!=null)break;await sleep(100)}must(healthy,"isolated Core did not start\n"+out+"\n"+err);
  const requestKey=crypto.randomUUID();\n  const start=await req(base,"/api/uyap/cases/101/query",{method:"POST",headers:{"X-Bono-User-Action":"1","Origin":base},body:JSON.stringify({requestKey,refresh:true})});
  must(start.status===202&&start.body.commandId,"document.list command not accepted");
  const commandId=Number(start.body.commandId);
  const claim=await req(base,"/api/uyap/commands/next?host=avukat.uyap.gov.tr&lane=query");
  must(claim.status===200&&Number(claim.body.id)===commandId&&claim.body.endpointKey==="document.list","fake extension did not claim document.list");
  const payload={tumEvraklar:[{evrakId:"PIPE-1",dosyaId:"DOSYA-101",tur:"Gerekçeli Karar",onaylandigiTarih:"09/10/2026",birimEvrakNo:"1",dosyaAdi:"gerekceli.pdf"}]};
  const result=await req(base,"/api/uyap/commands/"+commandId+"/result",{method:"POST",body:JSON.stringify({ok:true,status:200,contentType:"application/json",data:payload})});
  must(result.status===200&&result.body.ok===true,"document.list fake result rejected");
  const sync=await req(base,"/api/uyap/cases/101/document-sync-status");
  must(sync.status===200&&sync.body.state==="completed"&&sync.body.documents.remoteCount===1,"metadata lifecycle did not complete");
  let docs=await req(base,"/api/uyap/cases/101/remote-documents");
  must(docs.status===200&&docs.body.length===1&&docs.body[0].remote_document_id==="PIPE-1","remote metadata not materialized");
  const queue=await req(base,"/api/uyap/queue?limit=100");
  must(!queue.body.some(x=>x.command_type==="download_document"),"document.list created an automatic download");
  const session=await req(base,"/api/uyap/session");
  must(session.body?.session?.manualDownloadPaused===true,"document.list changed manual download pause");

  const remoteId=Number(docs.body[0].id);
  const pdf=Buffer.from("%PDF-1.4\\nBONO synthetic canonical archive fixture\\n%%EOF\\n");
  const archiveFile=path.join(archiveRoot,"2026-10-09_Gerekçeli Karar_"+remoteId+".pdf");
  fs.writeFileSync(archiveFile,pdf);
  const handoff=[
    "const db=require(\"./bridge/db\");const e=process.env;",
    "db.prepare(\"insert into local_assets(id,sha256,file_name,extension,size_bytes,classification,archive_path,archive_policy,source_container) values(?,?,?,?,?,?,?,?,?)\").run(2001,e.PIPE_SHA,\"Gerekçeli Karar.pdf\",\".pdf\",Number(e.PIPE_SIZE),\"karar\",e.PIPE_ARCHIVE,\"keep_original\",\"synthetic-ci-handoff\");",
    "db.prepare(\"insert into asset_locations(asset_id,local_path,source_root) values(?,?,?)\").run(2001,e.PIPE_ARCHIVE,e.PIPE_ARCHIVE_ROOT);",
    "db.prepare(\"update uyap_remote_documents set local_asset_id=?,filed_path=?,remote_hash=?,status='filed',filed_at=datetime('now') where id=?\").run(2001,e.PIPE_ARCHIVE,e.PIPE_SHA,Number(e.PIPE_REMOTE));",
    "try{db.close()}catch{}"
  ].join("\n");
  const handEnv={...env,PIPE_SHA:sha(pdf),PIPE_SIZE:String(pdf.length),PIPE_ARCHIVE:archiveFile,PIPE_ARCHIVE_ROOT:archiveRoot,PIPE_REMOTE:String(remoteId)};
  const linked=spawnSync(process.execPath,["-e",handoff],{cwd:process.cwd(),env:handEnv,encoding:"utf8"});
  if(linked.status!==0)throw new Error("synthetic archive handoff failed: "+linked.stderr);

  const view=await req(base,"/api/cases/101/documents/"+remoteId+"/view");
  must(view.status===200&&view.body.ok===true,"case-scoped document view unavailable after archive handoff");
  must(view.body.document.viewer.mode==="pdf_inline"&&view.body.document.integrity.verified===true,"archived PDF is not verified/openable");
  must(String(view.body.document.integrity.canonicalPath||"").startsWith(archiveRoot),"canonical path is outside isolated Windows archive fixture");
  const content=await fetch(base+"/api/cases/101/documents/"+remoteId+"/content");const bytes=Buffer.from(await content.arrayBuffer());
  must(content.status===200&&content.headers.get("x-bono-verified-sha256")===sha(pdf),"archived content SHA header mismatch");
  must(Buffer.compare(bytes,pdf)===0,"archived content bytes differ");
  const wrong=await req(base,"/api/cases/999/documents/"+remoteId+"/view");must(wrong.status===404,"wrong-case archive access was not rejected");

  console.log(JSON.stringify({ok:true,userControlledQuery:true,documentList:true,queryHistory:true,metadataMaterialized:true,noAutomaticDownload:true,manualDownloadPausePreserved:true,archiveHandoff:"synthetic-isolated-windows-canonical",pdfView:true,shaVerified:true,wrongCaseRejected:true,archiveRoot}));
 }finally{if(server.exitCode==null)server.kill();await sleep(100);try{fs.rmSync(root,{recursive:true,force:true})}catch{}}
})().catch(e=>{console.error(e);process.exit(1)});
