const base="http://127.0.0.1:47831";
const tests=[];
function ok(name,pass,detail=""){tests.push({name,pass:!!pass,detail});if(!pass)console.error("FAIL",name,detail)}
async function get(p){const r=await fetch(base+p);if(!r.ok)throw new Error(p+" HTTP "+r.status);return r.json()}
async function post(p,b){const r=await fetch(base+p,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});if(!r.ok)throw new Error(p+" HTTP "+r.status+" "+await r.text());return r.json()}
(async()=>{
 const h=await get("/health");ok("health schema 4",h.ok&&h.schema===4,JSON.stringify(h));
 const s=await get("/api/summary");ok("24 clients imported",s.clients===24,String(s.clients));ok("24 powers imported",s.powers===24,String(s.powers));
 const intel=await get("/api/intelligence/status");ok("UDF analysis substantial",intel.analyzed>=350,JSON.stringify(intel));ok("template memory",intel.templates>=40,String(intel.templates));ok("knowledge chunks",intel.chunks>=1500,String(intel.chunks));
 const ks=await get("/api/knowledge/search?q="+encodeURIComponent("bilirkişi"));ok("local evidence search",Array.isArray(ks.results)&&ks.results.length>0,String(ks.results?.length));
 const gs=await get("/api/search?q="+encodeURIComponent("Özkan"));ok("global search",Array.isArray(gs.results)&&gs.results.length>0,String(gs.results?.length));
 const perms=await get("/api/ai/permissions");ok("AI permission matrix",Array.isArray(perms)&&perms.length>=8,String(perms.length));ok("UYAP send denied",perms.some(x=>x.capability==="send_uyap"&&x.level==="deny"));ok("sign denied",perms.some(x=>x.capability==="sign_document"&&x.level==="deny"));
 const us=await get("/api/uyap/status");ok("UYAP observe only",us.rate.integration_mode==="observe_only",us.rate.integration_mode);ok("UYAP min 2200ms",us.globalMinIntervalMs>=2200,String(us.globalMinIntervalMs));
 const dl=await post("/api/deadlines/calculate",{title:"Regression",triggerDate:"2026-10-01",deliveryMode:"uets",periodDays:14,countFromNextDay:true,adjustNonWorkingDay:true});
 ok("UETS +5 trace",dl.deemedServiceDate==="2026-10-06",dl.deemedServiceDate);ok("deadline stays draft",dl.confidence==="draft"&&dl.lawyerApproved===false,JSON.stringify({confidence:dl.confidence,lawyerApproved:dl.lawyerApproved}));
 const assets=await get("/api/assets?limit=100");ok("generic images hidden",assets.every(x=>![".jpg",".jpeg",".png",".webp"].includes(String(x.extension||"").toLowerCase())||x.suggested_client||x.classification==="vekalet"));
 const fin=await get("/api/finance/overview");ok("finance API",typeof fin.contracted==="number"&&Array.isArray(fin.clients));
 const comm=await get("/api/communication-status");ok("WhatsApp official adapter state",comm.whatsapp?.mode==="official_cloud_api",JSON.stringify(comm));
 const sh=await get("/api/service-health");ok("server heartbeat",sh.some(x=>x.service==="server"&&x.state==="ok"));ok("worker heartbeat",sh.some(x=>x.service==="worker"&&x.state==="ok"));
 const drafts=await get("/api/drafts");ok("draft API",Array.isArray(drafts));
 const failed=tests.filter(x=>!x.pass);console.log(JSON.stringify({at:new Date().toISOString(),passed:tests.length-failed.length,failed:failed.length,tests},null,2));if(failed.length)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1)});
