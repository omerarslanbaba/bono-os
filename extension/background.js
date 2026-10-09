importScripts("runtime_mode.js");
const OBSERVATION_ONLY=BONO_RUNTIME_CONFIG.mode==="observation_only";
const LOCAL = "http://127.0.0.1:47831";
const AUTH_TTL_MS = 10 * 60 * 1000;
const AUTH_PATHS = new Set([
  "/kullanici_bilgileri.uyap","/menuListesiGetir.ajx","/get_avukat_id.ajx",
  "/get_kullanici_bildirimleri.ajx","/ws_sorgu_bakiyesi.ajx","/ws_gorusme_bakiyesi.ajx","/getNatsParameters.ajx",
  "/list_dosya_evraklar.ajx","/listDosyaEvraklarPageTotal.ajx","/getDocViewerParameters.ajx",
  "/dosyaAyrintiBilgileri_brd.ajx","/dosya_taraf_bilgileri_brd.ajx","/search_phrase_detayli.ajx",
  "/yargiBirimleriSorgula_brd.ajx","/avukat_mahkemeleri_sorgula.ajx","/avukat_durusma_sorgula_brd.ajx",
  "/getDosyaAramaParameters.ajx","/illeri_getirJSON.ajx","/cbs_birim_sorgula.ajx","/avukat_dosya_sorgula_cbs_brd.ajx"
]);
const store = chrome.storage.session || chrome.storage.local;
const authKey = id => "bonoUyapAuth:" + id;

async function nextCommand(host,lane="any") {
  if(OBSERVATION_ONLY)return;
  const r = await fetch(LOCAL + "/api/uyap/commands/next?host=" + encodeURIComponent(host) + "&lane=" + encodeURIComponent(lane), {cache:"no-store"});
  if (r.status === 204) {const reason=r.headers.get('X-Bono-Wait-Reason');return waitReasons.has(reason)?{wait:true,reason}:null;}
  if (!r.ok) throw new Error("BONO Core HTTP " + r.status);
  return await r.json();
}
async function setTabAuth(tabId, ok) {
  if (!tabId) return;
  await store.set({[authKey(tabId)]:{ok:!!ok,ts:Date.now()}});
  if (!ok) {
    const x = await store.get("bonoUyapExecutorTabId");
    if (Number(x.bonoUyapExecutorTabId||0) === Number(tabId)) await store.remove("bonoUyapExecutorTabId");
  }
}
async function isTabAuth(tabId) {
  if (!tabId) return false;
  const x = await store.get(authKey(tabId)), v = x[authKey(tabId)];
  return !!(v?.ok && Date.now() - Number(v.ts||0) < AUTH_TTL_MS);
}
async function setExecutor(tabId) {
  if (tabId) await store.set({bonoUyapExecutorTabId:Number(tabId)});
  else await store.remove("bonoUyapExecutorTabId");
}
async function getExecutor() {
  const x = await store.get("bonoUyapExecutorTabId");
  return Number(x.bonoUyapExecutorTabId||0)||null;
}
function looksLikeApp(tab) {
  try { return new URL(tab?.url||"").pathname === "/web1.uyap"; } catch { return false; }
}
function authenticatedObservation(data) {
  try {
    const u = new URL(data?.url||"");
    const okStatus = Number(data?.status||0) >= 200 && Number(data?.status||0) < 400;
    return !data?.responseSummary?.applicationError && okStatus && /json/i.test(String(data?.contentType||"")) && AUTH_PATHS.has(u.pathname);
  } catch { return false; }
}
const probedActions=new Set();
const claimedCommands=new Map();
const waitReasons=new Set(['uyap_login_required','local_return_hold','observe_only','rate_limit','lane_rate_limit','lane_busy','error_backoff','permission_denied']);
const claimKey=id=>'bonoClaim:'+id;
async function sessionCheckRequest(action,body){
 const r=await fetch(LOCAL+'/api/uyap/session-check/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Bono-Bridge':'1'},body:JSON.stringify(body)});
 if(!r.ok)throw Error('session_check_rejected');return r.json();
}
async function rememberClaim(id,claim){
 claimedCommands.set(id,claim);
 // Session storage survives MV3 worker suspension, but not a browser restart.
 // Never store request parameters, credentials, response bodies or document content.
 if(chrome.storage.session)await chrome.storage.session.set({[claimKey(id)]:claim});
}
async function readClaim(id){
 const claim=claimedCommands.get(id)||(chrome.storage.session?(await chrome.storage.session.get(claimKey(id)))[claimKey(id)]:null);
 if(!claim||Date.now()-claim.at>600000||claim.buildId!==BONO_RUNTIME_CONFIG.buildId){claimedCommands.delete(id);if(chrome.storage.session)await chrome.storage.session.remove(claimKey(id));return null;}
 return claim;
}
async function reportBridgeStatus(sender,message){
 if(!sender.tab?.id||Number(sender.frameId||0)!==0||new URL(sender.tab.url||'').origin!=='https://avukat.uyap.gov.tr')return;
 await fetch(LOCAL+'/api/uyap/bridge-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:message.state,commandId:message.commandId,tabId:sender.tab.id,frameId:0,waitReason:waitReasons.has(message.waitReason)?message.waitReason:null})});
}
async function senderCanExecute(sender) {
  if (!sender?.tab?.id || Number(sender.frameId||0)!==0) return false;
  const tabId = Number(sender.tab.id);
  try {
    const r=await fetch(LOCAL+"/api/uyap/user-query-state",{cache:"no-store"});
    if(!r.ok)throw Error('core_unavailable');
    const action=await r.json();
    const tab=await chrome.tabs.get(tabId);
    if(new URL(tab.url).origin!=='https://avukat.uyap.gov.tr')return false;
    if(action.sessionCheck?.state==='pending'){
      // Core atomically claims this separate, explicit check; it never claims query work.
      const check=await sessionCheckRequest('claim',{id:action.sessionCheck.id,tabId,frameId:0,documentId:sender.bonoDocumentId,buildId:BONO_RUNTIME_CONFIG.buildId});
      if(!chrome.storage.session)throw Error('probe_unavailable');
      await chrome.storage.session.set({bonoSessionCheck:check});
      await chrome.tabs.sendMessage(tabId,{type:'BONO_SESSION_CHECK',check},{frameId:0});return false;
    }
    if(['pending','claimed'].includes(action.sessionCheck?.state))return false;
    if (await isTabAuth(tabId)) {await setExecutor(tabId);return true;}
    if(action.pending&&action.actionId&&!probedActions.has(action.actionId)){
      probedActions.add(action.actionId);
      const key='bonoAuthProbe:'+action.actionId;
      // Mark before dispatch: uncertain worker interruption must not send a second portal probe.
      if(chrome.storage.session){const previous=(await chrome.storage.session.get(key))[key];if(previous)return false;await chrome.storage.session.set({[key]:true});}
      try{await chrome.tabs.sendMessage(tabId,{type:"BONO_AUTH_PROBE"},{frameId:0});}catch{throw Error('probe_unavailable');}
    }
  } catch(e){throw Error(e.message==='probe_unavailable'?'probe_unavailable':'core_unavailable');}
  return false;
}
async function wakeUyapTabs() { /* No automatic portal requests. */ }
function ensureAlarm() { if(OBSERVATION_ONLY)return; chrome.alarms.create("bono-uyap-poll",{periodInMinutes:0.5}); }

chrome.runtime.onInstalled.addListener(()=>{ensureAlarm();wakeUyapTabs();});
chrome.runtime.onStartup.addListener(()=>{ensureAlarm();wakeUyapTabs();});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==="bono-uyap-poll")wakeUyapTabs();});
chrome.tabs.onActivated.addListener(async info=>{
  if(OBSERVATION_ONLY){if(observationSession&&info.tabId!==observationSession.tabId)await stopObservation();return;}
  const tab=await chrome.tabs.get(info.tabId).catch(()=>null);
  if(tab?.url?.includes(".uyap.gov.tr/")){
    await setExecutor(null);
    /* Auth probes require a pending explicit user action. */
    setTimeout(wakeUyapTabs,800);
  }
});
chrome.tabs.onUpdated.addListener((tabId,info,tab)=>{
  if(OBSERVATION_ONLY){if(observationSession?.tabId===tabId&&(info.url||info.status==="loading"))stopObservation();return;}
  if(info.status==="complete"&&tab.url?.includes(".uyap.gov.tr/"))wakeUyapTabs();
});
chrome.tabs.onRemoved.addListener(async tabId=>{
  if(OBSERVATION_ONLY){if(observationSession?.tabId===tabId)await stopObservation();return;}
  await store.remove(authKey(tabId));
  if((await getExecutor())===tabId)await setExecutor(null);
});

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(!message)return;
  if(OBSERVATION_ONLY){handleObservationMessage(message,sender).then(sendResponse).catch(()=>sendResponse({ok:false,error:"observation_unavailable"}));return true;}
  if(message.type==='BONO_BRIDGE_STATUS'){reportBridgeStatus(sender,message).then(()=>sendResponse({ok:true})).catch(()=>sendResponse({ok:false}));return true;}
  if(message.type==='BONO_SESSION_CHECK_RESULT'){
    (async()=>{
      const check=chrome.storage.session?(await chrome.storage.session.get('bonoSessionCheck')).bonoSessionCheck:null,data=message.data||{};
      if(!check||check.id!==data.id||check.tabId!==sender.tab?.id||sender.frameId!==0||new URL(sender.tab.url).origin!=='https://avukat.uyap.gov.tr'||check.documentId!==data.documentId||check.buildId!==BONO_RUNTIME_CONFIG.buildId)throw Error('session_check_context_mismatch');
      const out=await sessionCheckRequest('result',{...check,status:Number(data.status),validJson:data.validJson===true,applicationError:data.applicationError===true});
      await setTabAuth(check.tabId,out.state==='ready');sendResponse({ok:true,state:out.state});
    })().catch(()=>sendResponse({ok:false,reason:'session_check_rejected'}));return true;
  }
  if(message.type==="BONO_CAPTURE"){
    (async()=>{
      const p=message.payload||{},data=p.data||{},tabId=sender.tab?.id,frameId=Number(sender.frameId||0);
      if(p.kind==="page_seen" && frameId!==0){sendResponse({ok:true,ignored:"subframe_page_seen"});return;}
      if(tabId && frameId===0){
        if(p.kind==="network_observation"){
          const status=Number(data.status||0);
          let path="";
          try{path=new URL(data.url||"").pathname}catch{}
          if(path==="/get_avukat_id.ajx"&&!authenticatedObservation(data)){
            await setTabAuth(tabId,false);
          }else if(authenticatedObservation(data)){
            await setTabAuth(tabId,true);
            if(sender.tab?.active || !(await getExecutor()))await setExecutor(tabId);
          }
        } else if(p.kind==="page_seen") {
          const pagePath=String(data.path||"");
          if(/login/i.test(pagePath)) await setTabAuth(tabId,false);
        }
      }
      const r=await fetch(LOCAL+"/events",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({capturedAt:new Date().toISOString(),sourceUrl:sender.tab?.url||"",tabId:tabId??null,frameId,payload:p})});
      sendResponse({ok:r.ok});
    })().catch(e=>sendResponse({ok:false,reason:['probe_unavailable','core_unavailable'].includes(e.message)?e.message:'core_unavailable'}));
    return true;
  }
  if(message.type==="BONO_POLL"){
    (async()=>{
      const senderUrl=new URL(sender.tab?.url||'');
      if(!sender.tab?.id||Number(sender.frameId||0)!==0||senderUrl.protocol!=='https:'||!senderUrl.hostname.endsWith('.uyap.gov.tr')||message.host!==senderUrl.hostname){sendResponse({ok:false,reason:'wrong_executor_context'});return;}
      if(!(await senderCanExecute({...sender,bonoDocumentId:message.documentId}))){sendResponse({ok:true,command:null,reason:"tab_not_authenticated"});return;}
      if(typeof message.documentId!=='string'||!message.documentId||message.documentId.length>80){sendResponse({ok:false,reason:'wrong_executor_context'});return;}
      const command=await nextCommand(String(message.host||""),String(message.lane||"any"));
      if(command?.id){
        await rememberClaim(Number(command.id),{tabId:sender.tab.id,frameId:0,at:Date.now(),documentId:message.documentId,browserDocumentId:sender.documentId||null,buildId:BONO_RUNTIME_CONFIG.buildId});
      }
      sendResponse({ok:true,command:command?.id?command:null,reason:command?.wait?(waitReasons.has(command.reason)?command.reason:'core_wait_unknown'):null});
    })().catch(e=>sendResponse({ok:false,reason:e.message==='probe_unavailable'?'probe_unavailable':'core_unavailable'}));
    return true;
  }
  if(message.type==="BONO_RESULT"){
    (async()=>{
      const data=message.data||{},tabId=sender.tab?.id;
      const claim=await readClaim(Number(data.id));
      if(!claim||claim.tabId!==tabId||Number(sender.frameId||0)!==claim.frameId||new URL(sender.tab?.url||'').origin!=='https://avukat.uyap.gov.tr'||claim.documentId!==data.executionContext?.documentId||(claim.browserDocumentId&&claim.browserDocumentId!==sender.documentId)||typeof data.executionContext?.id!=='string'||data.executionContext.id.length>80||(claim.executionId&&claim.executionId!==data.executionContext.id)){sendResponse({ok:false,reason:'executor_context_mismatch'});return;}
      if(!claim.executionId){claim.executionId=data.executionContext.id;await rememberClaim(Number(data.id),claim);}
      if(tabId&&Number(sender.frameId||0)===0){
        const ct=String(data.contentType||"");
        if(Number(data.status||0)===401||Number(data.status||0)===403){
          await setTabAuth(tabId,false);
        }else if(data.ok&&Number(data.status||0)>=200&&Number(data.status||0)<400){
          await setTabAuth(tabId,true);
          await setExecutor(tabId);
        }
      }
      if(!data.id){sendResponse({ok:false});return;}
      const r=await fetch(LOCAL+"/api/uyap/commands/"+encodeURIComponent(data.id)+"/result",{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)
      });
      const result=await r.json();
      sendResponse({ok:r.ok&&result.ok===true,received:r.ok,reason:result.reason||null});
    })().catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
});
async function migrateBridgeRuntime(){ /* Never reload a portal tab automatically. */ }
migrateBridgeRuntime();

let observationSession=null;
async function observationRequest(route,body){
 const response=await fetch(LOCAL+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Bono-Extension-Id':chrome.runtime.id},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(!response.ok)throw new Error('observation_core_unavailable');
 return response.json();
}
async function stopObservation(reason="user_stop"){
 const old=observationSession;observationSession=null;
 if(old)try{await chrome.tabs.sendMessage(old.tabId,{type:'BONO_OBSERVATION_DISARM'},{frameId:old.frameId});}catch{}
 try{await observationRequest('/observation/stop',{reason});}catch{}
}
async function handleObservationMessage(message,sender){
 const ownUI=sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('observation.html');
 if(message.type==='BONO_OBSERVATION_GET_STATUS'&&ownUI)return {ok:true,...await observationRequest('/observation/status')};
 if(message.type==='BONO_OBSERVATION_STOP'&&ownUI){await stopObservation();return {ok:true};}
 if(message.type==='BONO_OBSERVATION_START'&&ownUI){
  if(observationSession)return {ok:false,error:'session_already_active'};
  const tab=await chrome.tabs.get(message.tabId);
  if(new URL(tab.url).origin!=='https://avukat.uyap.gov.tr')return {ok:false,error:'wrong_origin'};
  const health=await observationRequest('/health');
  if(!health.observationOnly||health.buildId!==BONO_RUNTIME_CONFIG.buildId)return {ok:false,error:'core_build_mismatch'};
  const ready=await chrome.tabs.sendMessage(tab.id,{type:'BONO_OBSERVATION_STATUS'},{frameId:message.frameId});
  if(!ready?.ready||ready.buildId!==BONO_RUNTIME_CONFIG.buildId||ready.probeVersion!==2||ready.causalVersion!==1)return {ok:false,error:'reload_or_probe_conflict'};
  const session=await observationRequest('/observation/start',{...message,buildId:ready.buildId,probeVersion:ready.probeVersion,causalVersion:ready.causalVersion,documentId:ready.documentId});
  observationSession={...session,tabId:tab.id,frameId:message.frameId};
  setTimeout(()=>{if(observationSession?.id===session.id)stopObservation();},Math.max(0,session.expires-Date.now()));
  try{
   const armed=await chrome.tabs.sendMessage(tab.id,{type:'BONO_OBSERVATION_ARM',session:observationSession},{frameId:message.frameId});
   if(!armed?.ok)throw new Error('arm_failed');
  }catch{await stopObservation();return {ok:false,error:'arm_failed'};}
  return {ok:true};
 }
 if(message.type==='BONO_CAPTURE'&&observationSession){
  const s=observationSession,d=message.payload?.data||{};
  if(sender.tab?.id!==s.tabId||Number(sender.frameId||0)!==s.frameId||d.documentId!==s.documentId||d.sessionId!==s.id)return {ok:false,ignored:true};
  if(message.payload.kind==='observation_stopped'){await stopObservation(d.reason||'context_stop');return {ok:true};}
  if(message.payload.kind!=='network_observation')return {ok:false,ignored:true};
  const result=await observationRequest('/events',{sessionId:s.id,documentId:s.documentId,tabId:s.tabId,frameId:s.frameId,payload:message.payload});
  if(result.state==='stopped')await stopObservation();
  return {ok:true,...result};
 }
 return {ok:true,ignored:true,command:null,reason:'observation_only'};
}
