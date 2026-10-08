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
  const r = await fetch(LOCAL + "/api/uyap/commands/next?host=" + encodeURIComponent(host) + "&lane=" + encodeURIComponent(lane), {cache:"no-store"});
  if (r.status === 204) return null;
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
    return okStatus && /json/i.test(String(data?.contentType||"")) && AUTH_PATHS.has(u.pathname);
  } catch { return false; }
}
async function senderCanExecute(sender) {
  if (!sender?.tab?.id || Number(sender.frameId||0)!==0) return false;
  const tabId = Number(sender.tab.id);
  if (await isTabAuth(tabId)) {
    await setExecutor(tabId);
    return true;
  }
  return false;
}
async function wakeUyapTabs() {
  try {
    const tabs = await chrome.tabs.query({url:["https://*.uyap.gov.tr/*"]});
    const active = tabs.find(t=>t.active) || null;
    if(active?.id){
      try{await chrome.tabs.sendMessage(active.id,{type:"BONO_AUTH_PROBE"},{frameId:0})}catch{}
      await new Promise(r=>setTimeout(r,700));
    }
    let chosen = null;
    if(active?.id && await isTabAuth(active.id)) chosen=active;
    if(!chosen){
      const executor=await getExecutor();
      const t=executor?tabs.find(x=>x.id===executor):null;
      if(t && await isTabAuth(t.id)) chosen=t;
    }
    if(!chosen){
      for(const t of tabs) if(await isTabAuth(t.id)){chosen=t;break}
    }
    if (!chosen?.id || !chosen.url) { await setExecutor(null); return; }
    await setExecutor(chosen.id);
    try{await chrome.tabs.sendMessage(chosen.id,{type:"BONO_AUTH_PROBE"},{frameId:0})}catch{}
  } catch {}
}
function ensureAlarm() { chrome.alarms.create("bono-uyap-poll",{periodInMinutes:0.5}); }

chrome.runtime.onInstalled.addListener(()=>{ensureAlarm();wakeUyapTabs();});
chrome.runtime.onStartup.addListener(()=>{ensureAlarm();wakeUyapTabs();});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==="bono-uyap-poll")wakeUyapTabs();});
chrome.tabs.onActivated.addListener(async info=>{
  const tab=await chrome.tabs.get(info.tabId).catch(()=>null);
  if(tab?.url?.includes(".uyap.gov.tr/")){
    await setExecutor(null);
    try{await chrome.tabs.sendMessage(tab.id,{type:"BONO_AUTH_PROBE"},{frameId:0})}catch{}
    setTimeout(wakeUyapTabs,800);
  }
});
chrome.tabs.onUpdated.addListener((tabId,info,tab)=>{
  if(info.status==="complete"&&tab.url?.includes(".uyap.gov.tr/"))wakeUyapTabs();
});
chrome.tabs.onRemoved.addListener(async tabId=>{
  await store.remove(authKey(tabId));
  if((await getExecutor())===tabId)await setExecutor(null);
});

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(!message)return;
  if(message.type==="BONO_CAPTURE"){
    (async()=>{
      const p=message.payload||{},data=p.data||{},tabId=sender.tab?.id,frameId=Number(sender.frameId||0);
      if(p.kind==="page_seen" && frameId!==0){sendResponse({ok:true,ignored:"subframe_page_seen"});return;}
      if(tabId && frameId===0){
        if(p.kind==="network_observation"){
          const status=Number(data.status||0);
          let path="";
          try{path=new URL(data.url||"").pathname}catch{}
          if((status===401||status===403)&&path==="/get_avukat_id.ajx"){
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
    })().catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
  if(message.type==="BONO_POLL"){
    (async()=>{
      if(!(await senderCanExecute(sender))){sendResponse({ok:true,command:null,reason:"tab_not_authenticated"});return;}
      const command=await nextCommand(String(message.host||""),String(message.lane||"any"));
      sendResponse({ok:true,command});
    })().catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
  if(message.type==="BONO_RESULT"){
    (async()=>{
      const data=message.data||{},tabId=sender.tab?.id;
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
      sendResponse({ok:r.ok});
    })().catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
});
async function migrateBridgeRuntime(){
  try{
    const key="bonoBridgeRuntimeVersion",version="0.3.8";
    const old=await chrome.storage.local.get(key);
    if(old[key]===version)return;
    await chrome.storage.local.set({[key]:version});
    const tabs=await chrome.tabs.query({url:["https://*.uyap.gov.tr/*"]});
    const active=tabs.find(t=>t.active)||tabs.find(t=>looksLikeApp(t));
    if(active?.id)await chrome.tabs.reload(active.id);
  }catch{}
}
migrateBridgeRuntime();
