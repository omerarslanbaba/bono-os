const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const net=require("node:net");
const {spawn,spawnSync}=require("node:child_process");
function must(v,m){if(!v)throw new Error(m)}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function freePort(){return await new Promise((resolve,reject)=>{const s=net.createServer();s.on("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p))})})}
async function req(base,url,options={}){const r=await fetch(base+url,{headers:{"Content-Type":"application/json",...(options.headers||{})},...options});const t=await r.text();let body;try{body=t?JSON.parse(t):null}catch{body=t}return {status:r.status,body}}

(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"bono-targeted-http-"));
 const dbPath=path.join(root,"fixture.db"),port=await freePort();
 const env={...process.env,BONO_DB_PATH:dbPath,BONO_PORT:String(port),BONO_DISABLE_WORKER:"1",USERPROFILE:root};
 const seed=[
  "const db=require(\"./bridge/db\");",
  "function setting(k,v){db.prepare(\"insert into app_settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value\").run(k,v)}",
  "setting(\"uyap_integration_mode\",\"browser_readonly\");setting(\"uyap_session_state\",\"ready\");setting(\"uyap_manual_download_pause\",\"1\");setting(\"uyap_document_download_state\",\"paused_manual\");",
  "db.prepare(\"insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms) values(?,?,?,?,?,?,?)\").run(\"case.search\",\"POST\",\"avukat.uyap.gov.tr\",\"/search_phrase_detayli.ajx\",\"search\",1,0);",
  "db.prepare(\"insert or replace into uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms) values(?,?,?,?,?,?,?)\").run(\"case.units\",\"POST\",\"avukat.uyap.gov.tr\",\"/yargiBirimleriSorgula_brd.ajx\",\"units\",1,0);",
  "db.prepare(\"insert into uyap_endpoint_observations(method,host,path,status,content_type,sample_keys_json,sample_request_json,last_seen_at,hit_count) values(?,?,?,?,?,?,?,?,?)\").run(\"POST\",\"avukat.uyap.gov.tr\",\"/search_phrase_detayli.ajx\",200,\"application/json\",\"[]\",JSON.stringify({query:{},body:{dosyaDurumKod:0,pageSize:500,pageNumber:1,birimId:\"\",birimTuru2:\"0926\",birimTuru3:\"1\"},headers:{\"Content-Type\":\"application/json\"}}),\"2026-10-08 16:00:00\",18);",
  "db.prepare(\"insert into uyap_command_queue(command_type,endpoint_key,payload_json,status,result_json,finished_at) values(?,?,?,?,?,?)\").run(\"fetch_json\",\"case.units\",JSON.stringify({query:{},body:{yargiTuru:\"1\"},context:{yargiTuru:1}}),\"completed\",JSON.stringify([{altSistKodu:-1,tablo:\"0926\",kod:\"İŞ MAHKEMESİ\"}]),\"2026-10-08 16:00:00\");",
  "try{db.close()}catch{}"
 ].join("\n");
 const seeded=spawnSync(process.execPath,["-e",seed],{cwd:process.cwd(),env,encoding:"utf8"});
 if(seeded.status!==0)throw new Error("seed failed: "+seeded.stderr);
 const server=spawn(process.execPath,["bridge/server.js"],{cwd:process.cwd(),env,stdio:["ignore","pipe","pipe"]});
 let out="",err="";server.stdout.on("data",d=>out+=d);server.stderr.on("data",d=>err+=d);
 const base="http://127.0.0.1:"+port;
 try{
  let healthy=false;for(let i=0;i<80;i++){try{if((await req(base,"/health")).status===200){healthy=true;break}}catch{}if(server.exitCode!=null)break;await sleep(100)}
  must(healthy,"fixture Core did not start\n"+out+"\n"+err);
  const opts=await req(base,"/api/uyap/case-search/options");
  must(opts.status===200&&opts.body.ready===true&&opts.body.units.some(x=>x.birimTuru2==="0926"),"observed search options not ready");
  const missingNumber=await req(base,"/api/uyap/case-search",{method:"POST",body:JSON.stringify({yargiTuru:1,birimTuru2:"0926",court:"Eskişehir Cumhuriyet Başsavcılığı",year:2026,dosyaDurumKod:0})});
  must(missingNumber.status!==202,"numberless targeted search was incorrectly accepted");
  const before=await req(base,"/api/uyap/queue?limit=100");
  must(!before.body.some(x=>x.endpoint_key==="case.search"),"numberless targeted search created a command");
  const start=await req(base,"/api/uyap/case-search",{method:"POST",body:JSON.stringify({yargiTuru:1,birimTuru2:"0926",court:"Kocaeli 3. İş Mahkemesi",year:2026,baseNumber:100,dosyaDurumKod:0})});
  must(start.status===202&&start.body.accepted===true&&start.body.searchId&&start.body.commandId,"targeted search not accepted");
  const claim=await req(base,"/api/uyap/commands/next?host=avukat.uyap.gov.tr&lane=query");
  must(claim.status===200&&Number(claim.body.id)===Number(start.body.commandId)&&claim.body.endpointKey==="case.search","targeted case.search not claimed");
  const sent=claim.body.payload?.body||{};
  must(JSON.stringify(sent)===JSON.stringify({dosyaDurumKod:0,pageSize:500,pageNumber:1,birimId:"",birimTuru2:"0926",birimTuru3:"1"}),"request differs from observed schema: "+JSON.stringify(sent));
  must(!("year" in sent)&&!("baseNumber" in sent)&&!("court" in sent),"guessed semantic fields leaked to UYAP request");
  let st=await req(base,"/api/uyap/case-search/"+encodeURIComponent(start.body.searchId));must(st.body.state==="running","running state missing");
  const resultData=[[{dosyaId:"OTHER",dosyaNo:"2026/99",dosyaDurumKod:0,dosyaDurum:"Açık",dosyaTurKod:15,dosyaTur:"Hukuk Dava Dosyası",birimAdi:"Kocaeli 3. İş Mahkemesi",birimId:"111",birimTuru2:"0926",birimTuru3:"1"},{dosyaId:"MATCH",dosyaNo:"2026/100",dosyaDurumKod:0,dosyaDurum:"Açık",dosyaTurKod:15,dosyaTur:"Hukuk Dava Dosyası",birimAdi:"Kocaeli 3. İş Mahkemesi",birimId:"333",birimTuru2:"0926",birimTuru3:"1"}],2];
  const done=await req(base,"/api/uyap/commands/"+start.body.commandId+"/result",{method:"POST",body:JSON.stringify({ok:true,status:200,contentType:"application/json",data:resultData})});must(done.status===200&&done.body.ok===true,"fake result rejected");
  st=await req(base,"/api/uyap/case-search/"+encodeURIComponent(start.body.searchId));
  must(st.status===200&&st.body.state==="completed"&&st.body.success===true&&st.body.match?.caseId,"targeted result did not resolve BONO case");
  must(st.body.match.fileNo==="2026/100"&&st.body.match.court==="Kocaeli 3. İş Mahkemesi","wrong targeted match");
  const cases=await req(base,"/api/uyap/cases");const persisted=cases.body.filter(x=>String(x.court_file_no)==="2026/100");
  must(persisted.length===1&&Number(persisted[0].id)===Number(st.body.match.caseId),"found case not available in BONO case list");
  const docs=await req(base,"/api/uyap/cases/"+st.body.match.caseId+"/remote-documents");must(docs.status===200&&Array.isArray(docs.body),"found case detail contract unavailable");
  const q=await req(base,"/api/uyap/queue?limit=100");must(!q.body.some(x=>x.endpoint_key==="document.list"||x.command_type==="download_document"),"targeted search triggered document/download work");
  const ui=fs.readFileSync(path.join(process.cwd(),"web","js","views","active","uyap.js"),"utf8");
  must(ui.includes("api.uyapCaseSearchStatus(searchId)")&&ui.includes("a.href='#uyap/'+id"),"UI does not link completed targeted search to BONO detail");
  must(ui.includes("Soruşturma numarasını bilmiyor musun?")&&ui.includes("Bu hedefli arama numara gerektirir"),"unknown-number limitation warning missing from UI");
  console.log(JSON.stringify({ok:true,observedSchema:true,targetedHttp:true,exactMatchOnly:true,foundCasePersisted:true,detailRouteReady:true,noDocumentOrDownloadSideEffect:true,unknownNumberNotAssumed:true}));
 }finally{if(server.exitCode==null)server.kill();await sleep(100);fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
