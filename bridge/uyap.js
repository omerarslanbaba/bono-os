const db=require("./db");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

const GLOBAL_MIN_INTERVAL_MS=1300;
const JITTER_MAX_MS=450;
const LANE_NEXT_ALLOWED_MS={download:0,query:0};
const AUTHENTICATED_OBSERVATION_PATHS=new Set([
  "/kullanici_bilgileri.uyap","/menuListesiGetir.ajx","/get_avukat_id.ajx",
  "/get_kullanici_bildirimleri.ajx","/ws_sorgu_bakiyesi.ajx","/ws_gorusme_bakiyesi.ajx","/getNatsParameters.ajx"
]);
const READ_ONLY_ENDPOINTS=new Map([
  ["/list_dosya_evraklar.ajx","POST"],
  ["/listDosyaEvraklarPageTotal.ajx","POST"],
  ["/getDocViewerParameters.ajx","POST"],
  ["/view_document_brd.uyap","GET"],
  ["/dosyaAyrintiBilgileri_brd.ajx","POST"],
  ["/dosya_taraf_bilgileri_brd.ajx","POST"],
  ["/search_phrase_detayli.ajx","POST"],
  ["/yargiBirimleriSorgula_brd.ajx","POST"],
  ["/avukat_mahkemeleri_sorgula.ajx","POST"],
  ["/avukat_durusma_sorgula_brd.ajx","POST"],
  ["/getDosyaAramaParameters.ajx","POST"],
  ["/illeri_getirJSON.ajx","POST"],
  ["/cbs_birim_sorgula.ajx","POST"],
  ["/avukat_dosya_sorgula_cbs_brd.ajx","POST"]
]);

function isUyapHost(host){
  host=String(host||"").toLowerCase();
  return host==="uyap.gov.tr" || host.endsWith(".uyap.gov.tr");
}
const SENSITIVE_KEY=/token|auth|cookie|session|csrf|xsrf|password|passwd|sifre|şifre|pin|imza|signature|captcha|secret|credential/i;
function nrm(s){
  return String(s||"").replace(/İ/g,"I").replace(/ı/g,"i").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function uyapOpaqueId(v){
  let s=String(v??"").trim();
  if(!s)return "";
  if((s.startsWith('"')&&s.endsWith('"'))||(s.startsWith("'")&&s.endsWith("'"))){
    try{const x=JSON.parse(s);if(typeof x==="string")s=x;else s=s.slice(1,-1)}
    catch{s=s.slice(1,-1)}
  }
  return String(s).trim();
}
function sanitizeObservedRequest(value,depth=0){
  if(depth>3||value==null)return value==null?null:undefined;
  if(Array.isArray(value))return value.slice(0,20).map(v=>sanitizeObservedRequest(v,depth+1)).filter(v=>v!==undefined);
  if(typeof value==="object"){
    const out={};
    for(const [k,v] of Object.entries(value).slice(0,60)){
      if(SENSITIVE_KEY.test(k)){out[k]="[REDACTED]";continue}
      const x=sanitizeObservedRequest(v,depth+1);if(x!==undefined)out[k]=x;
    }
    return out;
  }
  if(["string","number","boolean"].includes(typeof value))return typeof value==="string"?value.slice(0,500):value;
  return undefined;
}
function sanitizeResultData(value,depth=0){
  if(depth>6||value==null)return value==null?null:undefined;
  if(Array.isArray(value))return value.slice(0,500).map(v=>sanitizeResultData(v,depth+1)).filter(v=>v!==undefined);
  if(typeof value==="object"){
    const out={};
    for(const [k,v] of Object.entries(value).slice(0,120)){
      if(SENSITIVE_KEY.test(k)){out[k]="[REDACTED]";continue}
      const x=sanitizeResultData(v,depth+1);if(x!==undefined)out[k]=x;
    }
    return out;
  }
  if(["string","number","boolean"].includes(typeof value))return typeof value==="string"?value.slice(0,2000):value;
  return undefined;
}
function cleanObservation(input){
  const u=new URL(input.url);
  if(!isUyapHost(u.hostname)) throw new Error("UYAP dışı host reddedildi");
  const method=String(input.method||"GET").toUpperCase();
  const sampleKeys=Array.isArray(input.sampleKeys)?input.sampleKeys.slice(0,50).map(String):[];
  const request=sanitizeObservedRequest(input.request||null);
  const responseSummary=sanitizeObservedRequest(input.responseSummary||null);
  return {
    method,host:u.hostname.toLowerCase(),path:u.pathname,
    status:Number(input.status||0)||null,
    contentType:String(input.contentType||"").slice(0,160)||null,
    sampleKeys,request,responseSummary
  };
}
function observe(input){
  const x=cleanObservation(input);
  const requestJson=x.request?JSON.stringify(x.request):null;
  const responseJson=x.responseSummary?JSON.stringify(x.responseSummary):null;
  db.prepare(`INSERT INTO uyap_endpoint_observations
    (method,host,path,status,content_type,sample_keys_json,sample_request_json,sample_response_json)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(method,host,path) DO UPDATE SET
      status=excluded.status,
      content_type=excluded.content_type,
      sample_keys_json=CASE WHEN excluded.sample_keys_json!='[]' THEN excluded.sample_keys_json ELSE uyap_endpoint_observations.sample_keys_json END,
      sample_request_json=CASE WHEN excluded.sample_request_json IS NOT NULL AND excluded.sample_request_json!='{}' THEN excluded.sample_request_json ELSE uyap_endpoint_observations.sample_request_json END,
      sample_response_json=CASE WHEN excluded.sample_response_json IS NOT NULL AND excluded.sample_response_json!='{}' THEN excluded.sample_response_json ELSE uyap_endpoint_observations.sample_response_json END,
      last_seen_at=datetime('now'),
      hit_count=uyap_endpoint_observations.hit_count+1`)
    .run(x.method,x.host,x.path,x.status,x.contentType,JSON.stringify(x.sampleKeys),requestJson,responseJson);
  const explicitErrorObservation=x.sampleKeys.some(k=>["errorcode","error"].includes(String(k).toLowerCase()));
  if(AUTHENTICATED_OBSERVATION_PATHS.has(x.path)&&(x.status===401||x.status===403)){
    setSessionLoginRequired("auth_probe_http_"+x.status+":"+x.path);
  }else if(sessionState().state==="login_required"&&!explicitErrorObservation&&x.status>=200&&x.status<400&&/json/i.test(String(x.contentType||""))&&(READ_ONLY_ENDPOINTS.has(x.path)||AUTHENTICATED_OBSERVATION_PATHS.has(x.path))){
    recoverSession("successful_network_observation:"+x.path);
  }
  return x;
}
function observations(limit=300){
  return db.prepare(`SELECT * FROM uyap_endpoint_observations
    ORDER BY last_seen_at DESC,hit_count DESC LIMIT ?`).all(Number(limit)||300);
}
function endpoints(){
  return db.prepare("SELECT * FROM uyap_endpoints ORDER BY purpose,endpoint_key").all();
}
function approveEndpoint({endpointKey,method,host,path,purpose,minIntervalMs}){
  if(!endpointKey||!/^[a-z0-9_.-]{3,80}$/i.test(endpointKey)) throw new Error("Geçersiz endpoint anahtarı");
  host=String(host||"").toLowerCase();
  if(!isUyapHost(host)) throw new Error("UYAP dışı host reddedildi");
  path=String(path||"");
  if(!path.startsWith("/")) throw new Error("Path / ile başlamalı");
  method=String(method||"GET").toUpperCase();
  const expectedMethod=READ_ONLY_ENDPOINTS.get(path);
  if(!expectedMethod||expectedMethod!==method) throw new Error("Endpoint salt-okuma UYAP izin listesinde değil");
  const interval=Math.max(GLOBAL_MIN_INTERVAL_MS,Number(minIntervalMs)||GLOBAL_MIN_INTERVAL_MS);
  db.prepare(`INSERT INTO uyap_endpoints(endpoint_key,method,host,path,purpose,enabled,min_interval_ms,last_verified_at)
    VALUES(?,?,?,?,?,1,?,datetime('now'))
    ON CONFLICT(endpoint_key) DO UPDATE SET method=excluded.method,host=excluded.host,path=excluded.path,
      purpose=excluded.purpose,enabled=1,min_interval_ms=excluded.min_interval_ms,last_verified_at=datetime('now')`)
    .run(endpointKey,method,host,path,purpose||null,interval);
  return db.prepare("SELECT * FROM uyap_endpoints WHERE endpoint_key=?").get(endpointKey);
}
function setEndpointEnabled(endpointKey,enabled){
  const r=db.prepare("UPDATE uyap_endpoints SET enabled=? WHERE endpoint_key=?").run(enabled?1:0,endpointKey);
  if(!r.changes) throw new Error("Endpoint bulunamadı");
  return db.prepare("SELECT * FROM uyap_endpoints WHERE endpoint_key=?").get(endpointKey);
}
function enqueue({commandType,endpointKey,payload,priority=100,notBeforeMs=0}){
  if(integrationMode()!=="browser_readonly") throw new Error("UYAP entegrasyonu salt-okuma tarayıcı modunda değil; komut kuyruğu kapalı");
  const ep=db.prepare("SELECT * FROM uyap_endpoints WHERE endpoint_key=? AND enabled=1").get(endpointKey);
  if(!ep) throw new Error("Endpoint onaylı/aktif değil");
  const allowed=new Set(["fetch_json","download_document"]);
  if(!allowed.has(commandType)) throw new Error("Desteklenmeyen UYAP komutu");
  if(commandType==="download_document" && ep.path!=="/view_document_brd.uyap") throw new Error("Belge indirme yalnız PDF görüntüleme endpointinde izinli");
  if(commandType==="fetch_json" && ep.path==="/view_document_brd.uyap") throw new Error("PDF endpointi JSON okuma için kullanılamaz");
  const r=db.prepare(`INSERT INTO uyap_command_queue(command_type,endpoint_key,payload_json,priority,not_before_ms)
    VALUES(?,?,?,?,?)`).run(commandType,endpointKey,JSON.stringify(payload||{}),Number(priority)||100,Number(notBeforeMs)||0);
  return Number(r.lastInsertRowid);
}
function setting(key,defaultValue=null){
  const r=db.prepare("SELECT value FROM app_settings WHERE key=?").get(key);
  return r?r.value:defaultValue;
}
function setSetting(key,value){
  db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')`).run(key,String(value??""));
}
function sessionState(){
  const manualDownloadPaused=setting("uyap_manual_download_pause","0")==="1";
  const rawDocumentState=setting("uyap_document_download_state","ready");
  return {
    state:setting("uyap_session_state","ready"),
    reason:setting("uyap_session_reason",""),
    since:setting("uyap_session_since",""),
    recoveredAt:setting("uyap_session_recovered_at",""),
    manualDownloadPaused,
    documentDownloadState:manualDownloadPaused?"paused_manual":rawDocumentState,
    documentDownloadReason:manualDownloadPaused?setting("uyap_manual_download_reason","manual_download_pause"):setting("uyap_document_download_reason","")
  };
}
function setDocumentDownloadState(state="ready",reason=""){
  setSetting("uyap_document_download_state",state);
  setSetting("uyap_document_download_reason",reason);
  if(state==="paused_manual"){
    setSetting("uyap_manual_download_pause","1");
    setSetting("uyap_manual_download_reason",reason||"manual_download_pause");
  }
  return sessionState();
}
function setManualDownloadPause(paused=true,reason="manual_download_pause"){
  setSetting("uyap_manual_download_pause",paused?"1":"0");
  setSetting("uyap_manual_download_reason",paused?String(reason||"manual_download_pause"):"");
  if(paused) setDocumentDownloadState("paused_manual",reason);
  else if(setting("uyap_document_download_state","ready")==="paused_manual") setDocumentDownloadState("ready","");
  return sessionState();
}
function setSessionLoginRequired(reason="uyap_session_expired"){
  const current=sessionState();
  if(current.state!=="login_required"){
    setSetting("uyap_session_since",new Date().toISOString());
    db.prepare(`INSERT INTO work_radar_items(item_type,title,detail,severity,status,source_entity_type,source_entity_id,fingerprint,metadata_json)
      VALUES('system','UYAP oturumu kapandı','UYAP yeniden giriş bekliyor. Belge indirmeleri güvenli biçimde durduruldu.','critical','open','system','uyap_session','system:uyap-login-required',?)
      ON CONFLICT(fingerprint) DO UPDATE SET title=excluded.title,detail=excluded.detail,severity='critical',status='open',resolved_at=NULL,detected_at=datetime('now'),metadata_json=excluded.metadata_json`)
      .run(JSON.stringify({reason}));
  }
  setSetting("uyap_session_state","login_required");
  setSetting("uyap_session_reason",reason);
  db.prepare("UPDATE uyap_rate_state SET state='uyap_login_required',updated_at=datetime('now') WHERE id=1").run();
  return sessionState();
}
function recoverSession(source="network_observation"){
  const current=sessionState();
  if(current.state!=="login_required"&&(current.documentDownloadState==="ready"||current.manualDownloadPaused))return current;
  setSetting("uyap_session_state","ready");
  setSetting("uyap_session_reason","");
  setSetting("uyap_session_recovered_at",new Date().toISOString());
  db.prepare("UPDATE work_radar_items SET status='resolved',resolved_at=datetime('now') WHERE fingerprint='system:uyap-login-required' AND status='open'").run();
  db.prepare("UPDATE uyap_rate_state SET circuit_open_until_ms=0,consecutive_failures=0,state='ready',updated_at=datetime('now') WHERE id=1").run();
  const retry=db.prepare("SELECT id FROM uyap_remote_documents WHERE local_asset_id IS NULL AND status='discovered' AND metadata_json LIKE '%uyap_portal_login_html%' ORDER BY id LIMIT 200").all();
  const sessionRefreshCommandIds=enqueueSessionTokenRefresh("session_recovery:"+source);
  return {...sessionState(),recoveredBy:source,requeuedAfterLogin:retry.length,sessionRefreshCommandIds};
}
function maybeFinishSessionRefresh(){
  const casePending=db.prepare(`SELECT count(*) n FROM uyap_command_queue
    WHERE endpoint_key='case.search' AND status IN ('queued','running')
      AND payload_json LIKE '%"sessionRefresh":true%'`).get().n;
  const docPending=db.prepare(`SELECT count(*) n FROM uyap_command_queue
    WHERE endpoint_key='document.list' AND status IN ('queued','running')
      AND payload_json LIKE '%"purpose":"session_refresh_documents"%'`).get().n;
  if(Number(casePending||0)===0&&Number(docPending||0)===0&&setting("uyap_session_state","ready")!=="login_required"){
    setDocumentDownloadState("ready","");
    return true;
  }
  return false;
}
function enqueueSessionTokenRefresh(source="session_recovery"){
  const rows=db.prepare("SELECT id,uyap_metadata_json FROM cases WHERE external_id LIKE 'uyap:%' AND uyap_metadata_json IS NOT NULL").all();
  const groups=new Map();
  const hist=db.prepare(`SELECT json_extract(payload_json,'$.context.yargiTuru') y
    FROM uyap_command_queue
    WHERE endpoint_key='case.search' AND status='completed'
      AND CAST(json_extract(payload_json,'$.context.birimTuru2') AS TEXT)=?
      AND json_extract(payload_json,'$.context.yargiTuru') IS NOT NULL
    ORDER BY id DESC LIMIT 1`);
  for(const r of rows){
    let m={};try{m=JSON.parse(r.uyap_metadata_json||"{}")}catch{}
    const b2=String(m?.birimTuru2||"").trim(); if(!b2)continue;
    let y=hist.get(b2)?.y;
    if(y===undefined||y===null){
      if(b2==="1101")y=2;
      else if(b2==="6701"||b2==="6702")y=25;
      else if(b2==="7702")y=0;
      else if(b2==="7703")y=1;
      else continue;
    }
    const searchStatus=Number(m?.dosyaDurumKod)===1?1:0;
    groups.set([Number(y),b2,searchStatus].join("|"),{yargiTuru:Number(y),birimTuru2:b2,dosyaDurumKod:searchStatus});
  }
  const ids=[];
  for(const g of groups.values()){
    const marker='%"sessionRefresh":true%';
    const active=db.prepare(`SELECT id FROM uyap_command_queue WHERE endpoint_key='case.search' AND status IN ('queued','running')
      AND json_extract(payload_json,'$.context.yargiTuru')=?
      AND CAST(json_extract(payload_json,'$.context.birimTuru2') AS TEXT)=?
      AND json_extract(payload_json,'$.context.dosyaDurumKod')=?
      AND payload_json LIKE ? ORDER BY id LIMIT 1`).get(g.yargiTuru,g.birimTuru2,g.dosyaDurumKod,marker);
    if(active?.id){ids.push(Number(active.id));continue}
    ids.push(enqueue({commandType:"fetch_json",endpointKey:"case.search",
      payload:{query:{},body:{dosyaDurumKod:g.dosyaDurumKod,pageSize:500,pageNumber:1,birimId:"",birimTuru2:g.birimTuru2,birimTuru3:String(g.yargiTuru)},
        context:{discovery:true,stage:"cases",yargiTuru:g.yargiTuru,birimTuru2:g.birimTuru2,dosyaDurumKod:g.dosyaDurumKod,pageNumber:1,syncDocuments:true,sessionRefresh:true,source:String(source||"session_recovery")}},
      priority:5}));
  }
  if(ids.length)setDocumentDownloadState("paused_token_refresh","refreshing_case_tokens:"+ids.length);
  else setDocumentDownloadState("ready","");
  return ids;
}
function integrationMode(){
  return setting("uyap_integration_mode","observe_only");
}
function rateState(){
  const state=db.prepare("SELECT * FROM uyap_rate_state WHERE id=1").get();
  return {...state,integration_mode:integrationMode()};
}
function claimNext(host,lane="any"){
  if(integrationMode()!=="browser_readonly") return {wait:true,reason:"observe_only",retryAfterMs:60000};
  if(sessionState().state==="login_required") return {wait:true,reason:"uyap_login_required",retryAfterMs:5000};
  lane=["download","query"].includes(String(lane||"").toLowerCase())?String(lane).toLowerCase():"any";
  if(setting("uyap_document_download_state","ready")==="paused_token_refresh"){
    const activeRefresh=db.prepare(`SELECT COUNT(*) n FROM uyap_command_queue
      WHERE status IN ('queued','running') AND
      (payload_json LIKE '%"sessionRefresh":true%' OR payload_json LIKE '%"purpose":"session_refresh_documents"%')`).get().n;
    if(!Number(activeRefresh||0))setDocumentDownloadState("ready","");
  }
  const documentDownloadsPaused=sessionState().manualDownloadPaused||setting("uyap_document_download_state","ready")!=="ready";
  db.prepare(`UPDATE uyap_command_queue SET status='queued',not_before_ms=0,error='stale command recovered'
    WHERE status='running' AND dispatched_at IS NOT NULL AND dispatched_at < datetime('now','-3 minutes')`).run();
  const now=Date.now();
  host=String(host||"").toLowerCase();
  if(host && !isUyapHost(host)) return null;
  const state=rateState();
  if(state.circuit_open_until_ms>now) return {wait:true,reason:state.state,retryAfterMs:state.circuit_open_until_ms-now};

  if(lane==="any"){
    if(state.next_allowed_ms>now) return {wait:true,reason:"rate_limit",retryAfterMs:state.next_allowed_ms-now};
  }else{
    const laneReady=Number(LANE_NEXT_ALLOWED_MS[lane]||0);
    if(laneReady>now) return {wait:true,reason:"lane_rate_limit",retryAfterMs:laneReady-now};
    const runningSql=lane==="download"
      ?"SELECT count(*) n FROM uyap_command_queue WHERE status='running' AND command_type='download_document'"
      :"SELECT count(*) n FROM uyap_command_queue WHERE status='running' AND command_type!='download_document'";
    const running=Number(db.prepare(runningSql).get()?.n||0);
    if(running>0) return {wait:true,reason:"lane_busy",retryAfterMs:500};
  }

  db.exec("BEGIN IMMEDIATE");
  try{
    const laneFilter=lane==="download"
      ?"AND q.command_type='download_document'"
      :(lane==="query"?"AND q.command_type!='download_document'":"");
    const baseSql=`SELECT q.*,e.method,e.host,e.path,e.min_interval_ms
      FROM uyap_command_queue q
      JOIN uyap_endpoints e ON e.endpoint_key=q.endpoint_key
      WHERE q.status='queued' AND q.attempts<q.max_attempts AND q.not_before_ms<=? AND e.enabled=1
      ${documentDownloadsPaused?"AND q.command_type!='download_document'":""}
      ${laneFilter}
      ${host?"AND e.host=?":""}`;
    const recent=db.prepare(`SELECT command_type FROM uyap_command_queue
      WHERE dispatched_at IS NOT NULL ORDER BY dispatched_at DESC,id DESC LIMIT 4`).all();
    const higherPriorityPending=Number(db.prepare(`SELECT count(*) n FROM uyap_command_queue
      WHERE status='queued' AND attempts<max_attempts AND not_before_ms<=? AND priority<8`).get(now)?.n||0)>0;
    const forceDownload=lane==="any"&&!higherPriorityPending&&recent.length>=4&&!recent.some(x=>x.command_type==="download_document");
    let row=null;
    if(forceDownload){
      const downloadSql=baseSql+` AND q.command_type='download_document'
        AND q.created_at<=datetime('now','-2 minutes')
        ORDER BY q.priority ASC,q.id ASC LIMIT 1`;
      row=host?db.prepare(downloadSql).get(now,host):db.prepare(downloadSql).get(now);
    }
    if(!row){
      const sql=baseSql+` ORDER BY q.priority ASC,q.id ASC LIMIT 1`;
      row=host?db.prepare(sql).get(now,host):db.prepare(sql).get(now);
    }
    if(!row){db.exec("COMMIT");return null}
    const spacing=Math.max(GLOBAL_MIN_INTERVAL_MS,Number(row.min_interval_ms)||0);
    const jitter=Math.floor(Math.random()*(JITTER_MAX_MS+1));
    db.prepare(`UPDATE uyap_command_queue SET status='running',attempts=attempts+1,dispatched_at=datetime('now'),error=NULL WHERE id=?`).run(row.id);
    if(lane!=="any")LANE_NEXT_ALLOWED_MS[lane]=now+spacing+jitter;
    db.prepare(`UPDATE uyap_rate_state SET last_dispatch_ms=?,next_allowed_ms=?,state='ready',updated_at=datetime('now') WHERE id=1`)
      .run(now,now+spacing+jitter);
    db.exec("COMMIT");
    return {
      id:row.id,
      lane:lane==="any"?(row.command_type==="download_document"?"download":"query"):lane,
      commandType:row.command_type,
      endpointKey:row.endpoint_key,
      method:row.method,
      host:row.host,
      path:row.path,
      payload:row.payload_json?JSON.parse(row.payload_json):{},
      hardMinIntervalMs:spacing
    };
  }catch(e){db.exec("ROLLBACK");throw e}
}
function reportResult(id,result={}){
  const row=db.prepare("SELECT * FROM uyap_command_queue WHERE id=?").get(id);
  if(!row) throw new Error("UYAP komutu bulunamadı");
  if(row.status==="completed") return {ok:true,state:"ready",circuitUntil:0,ignored:"already_completed"};
  if(row.status==="cancelled") return {ok:false,state:"ready",circuitUntil:0,ignored:"already_cancelled"};
  const status=Number(result.status||0)||0;
  const ok=!!result.ok && status>=200 && status<400;
  const now=Date.now();
  let state="ready",circuitUntil=0,failures=0;
  const current=rateState();
  const payload=row.payload_json?JSON.parse(row.payload_json):{};
  const ctx=payload?.context||{};
  const scopedDiscoveryDenied=row.endpoint_key==="case.search"&&ctx.discovery&&
    ["6701","6702","7100"].includes(String(ctx.birimTuru2||payload?.body?.birimTuru2||""))&&(status===401||status===403);
  const scopedUnitsDenied=row.endpoint_key==="case.units"&&ctx.discovery&&(status===401||status===403);
  const scopedDocumentDenied=row.endpoint_key==="document.list"&&(status===401||status===403)&&(()=>{
    const caseId=Number(ctx.caseId||0);
    const c=caseId?db.prepare("SELECT court,case_type FROM cases WHERE id=?").get(caseId):null;
    return /arabuluculuk/i.test(String(c?.court||"")+" "+String(c?.case_type||""));
  })();
  const staleDocumentListDenied=row.endpoint_key==="document.list"&&!scopedDocumentDenied&&(status===401||status===403);

  if(ok){
    const rawData=result.data==null?null:result.data;
    const cleanData=rawData==null?null:sanitizeResultData(rawData);
    const payload=row.payload_json?JSON.parse(row.payload_json):{};
    const ctx=payload?.context||{};
    const resultJson=cleanData==null?null:JSON.stringify(cleanData);
    db.prepare(`UPDATE uyap_command_queue SET status='completed',finished_at=datetime('now'),result_meta_json=?,result_json=? WHERE id=?`)
      .run(JSON.stringify(safeResult(result)),resultJson,id);
    if(row.endpoint_key==="document.viewer_params"&&ctx.purpose==="refresh_document_tokens"){
      const s=sessionState();
      if(s.documentDownloadReason==="refreshing_document_tokens") setDocumentDownloadState("ready","");
    }
    if(row.endpoint_key==="document.list"&&cleanData){
      const payload=row.payload_json?JSON.parse(row.payload_json):{};
      if(payload?.context?.caseId){
        const caseId=Number(payload.context.caseId);
        upsertRemoteList(caseId,cleanData,{baseline:false});
        // Dosya listesi senkronu yalnız metadata günceller. PDF indirme kullanıcı tarafından dosya bazında başlatılır.
        const refreshPurpose=String(payload?.context?.purpose||"");
        if(refreshPurpose==="refresh_stale_document_tokens"&&String(sessionState().documentDownloadState||"").startsWith("paused_")) setDocumentDownloadState("ready","");
        if(refreshPurpose==="session_refresh_documents") maybeFinishSessionRefresh();
      }
    }
    if(row.endpoint_key==="hearing.search"&&Array.isArray(cleanData)) upsertHearings(cleanData);
    if(row.endpoint_key==="case.units"&&ctx.discovery&&ctx.stage==="units"&&Array.isArray(cleanData)){
      const statuses=Array.isArray(ctx.statuses)&&ctx.statuses.length?ctx.statuses:[0,1];
      for(const unit of rawData){
        if(!unit?.tablo)continue;
        for(const s of statuses) enqueueCaseSearchPage({yargiTuru:ctx.yargiTuru,birimTuru2:unit.tablo,dosyaDurumKod:s,pageNumber:1,syncDocuments:ctx.syncDocuments});
      }
    }
    if(row.endpoint_key==="case.search"&&Array.isArray(cleanData)){
      upsertCasesFromSearch(cleanData);
      if(ctx.discovery&&ctx.stage==="cases"){
        const list=Array.isArray(cleanData?.[0])?cleanData[0]:[];
        const total=Number(cleanData?.[1]||0),pageSize=Number(payload?.body?.pageSize||500),page=Number(ctx.pageNumber||1);
        if(total>page*pageSize) enqueueCaseSearchPage({yargiTuru:ctx.yargiTuru,birimTuru2:ctx.birimTuru2,dosyaDurumKod:ctx.dosyaDurumKod,pageNumber:page+1,syncDocuments:ctx.syncDocuments});
        if(ctx.syncDocuments){
          for(const item of list){
            const ext="uyap:case:"+String(item?.birimId||"")+":"+String(item?.dosyaNo||"");
            const c=db.prepare("SELECT id FROM cases WHERE external_id=?").get(ext);
            if(c?.id){
              try{
                if(ctx.sessionRefresh) enqueueCaseDocumentSync(c.id,{priority:6,purpose:"session_refresh_documents",source:"session_case_search"});
                else enqueueCaseDocumentSync(c.id);
              }catch{}
            }
          }
        }
        if(ctx.sessionRefresh) maybeFinishSessionRefresh();
      }
    }
    if(row.endpoint_key==="cbs.provinces"&&ctx.discovery&&ctx.stage==="cbs_provinces"){
      const src=Array.isArray(rawData)?rawData:(Array.isArray(rawData?.iller)?rawData.iller:(Array.isArray(rawData?.data)?rawData.data:[]));
      let codes=[...new Set(src.map(provinceCode).filter(Boolean))];
      if(!codes.length) codes=Array.from({length:81},(_,i)=>i+1);
      for(const code of codes) enqueueCbsUnits(code,{statuses:ctx.statuses||[0,1],syncDocuments:ctx.syncDocuments});
    }
    if(row.endpoint_key==="cbs.units"&&ctx.discovery&&ctx.stage==="cbs_units"&&Array.isArray(rawData)){
      const statuses=Array.isArray(ctx.statuses)&&ctx.statuses.length?ctx.statuses:[0,1];
      for(const unit of rawData){
        const bid=cbsUnitId(unit); if(!bid)continue;
        for(const s of statuses) enqueueCbsSearchPage({ilKodu:ctx.ilKodu,birimId:bid,dosyaDurumKod:s,pageNumber:1,syncDocuments:ctx.syncDocuments});
      }
    }
    if(row.endpoint_key==="cbs.search"&&Array.isArray(cleanData)){
      upsertCasesFromSearch(cleanData);
      if(ctx.discovery&&ctx.stage==="cbs_cases"){
        const list=Array.isArray(cleanData?.[0])?cleanData[0]:[];
        const total=Number(cleanData?.[1]||0),pageSize=Number(payload?.body?.pageSize||500),page=Number(ctx.pageNumber||1);
        if(total>page*pageSize) enqueueCbsSearchPage({ilKodu:ctx.ilKodu,birimId:ctx.birimId,dosyaDurumKod:ctx.dosyaDurumKod,pageNumber:page+1,syncDocuments:ctx.syncDocuments});
        if(ctx.syncDocuments){
          for(const item of list){
            const ext="uyap:case:"+String(item?.birimId||"")+":"+String(item?.dosyaNo||"");
            const c=db.prepare("SELECT id FROM cases WHERE external_id=?").get(ext);
            if(c?.id){try{enqueueCaseDocumentSync(c.id)}catch{}}
          }
        }
      }
    }
  }else if(staleDocumentListDenied){
    db.prepare("UPDATE uyap_command_queue SET status='cancelled',finished_at=datetime('now'),error=?,result_meta_json=? WHERE id=?")
      .run("stale_document_list_http_"+status,JSON.stringify(safeResult(result)),id);
    if(ctx.purpose==="session_refresh_documents") maybeFinishSessionRefresh();
    failures=0; state="ready"; circuitUntil=0;
  }else if(scopedDiscoveryDenied||scopedUnitsDenied||scopedDocumentDenied){
    db.prepare("UPDATE uyap_command_queue SET status='cancelled',finished_at=datetime('now'),error=?,result_meta_json=? WHERE id=?").run("scope_unavailable_http_"+status,JSON.stringify(safeResult(result)),id);
    if(ctx.purpose==="session_refresh_documents") maybeFinishSessionRefresh();
    failures=0; state="ready"; circuitUntil=0;
  }else if(row.command_type==="download_document"&&/html/i.test(String(result.contentType||""))){
    db.prepare("UPDATE uyap_command_queue SET status='cancelled',finished_at=datetime('now'),error=?,result_meta_json=? WHERE id=?")
      .run("stale_remote_metadata_html",JSON.stringify(safeResult(result)),id);
    const remoteDbId=Number(ctx.remoteDocumentDbId||0);
    if(remoteDbId){
      db.prepare("UPDATE uyap_remote_documents SET status=CASE WHEN local_asset_id IS NULL THEN 'discovered' ELSE status END,last_seen_at=datetime('now') WHERE id=?")
        .run(remoteDbId);
    }
    const caseId=Number(ctx.caseId||0);
    if(caseId){
      try{
        const c=linkedUyapCase(caseId);
        if(c?.uyap_dosya_id){
          enqueueCaseDocumentSync(caseId,{priority:6,purpose:"refresh_stale_document_tokens",source:"stale_pdf:"+String(id)});
          // Tek bir dosyanın stale tokenı bütün indirme kuyruğunu durdurmaz.
          // Sadece ilgili komut iptal edilir ve o case'in evrak listesi yenilenir.
        }
      }catch{}
    }
    failures=0; state="ready"; circuitUntil=0;
  }else{
    failures=(current.consecutive_failures||0)+1;
    let retryDelay=Math.min(120000,15000*Math.pow(2,Math.max(0,row.attempts-1)));
    if(status===429){state="rate_limited";circuitUntil=now+15*60*1000;retryDelay=15*60*1000}
    else if(status===401||status===403){
      state="endpoint_auth_backoff";circuitUntil=0;retryDelay=60000;
    }
    else if(failures>=3){state="error_backoff";circuitUntil=now+10*60*1000;retryDelay=10*60*1000}
    const willRetry=row.attempts<row.max_attempts;
    db.prepare(`UPDATE uyap_command_queue SET status=?,not_before_ms=?,finished_at=CASE WHEN ?='failed' THEN datetime('now') ELSE NULL END,
      error=?,result_meta_json=? WHERE id=?`)
      .run(willRetry?"queued":"failed",now+retryDelay,willRetry?"queued":"failed",String(result.error||("HTTP "+status)),JSON.stringify(safeResult(result)),id);
  }
  db.prepare(`UPDATE uyap_rate_state SET consecutive_failures=?,last_status=?,state=?,circuit_open_until_ms=?,
    updated_at=datetime('now') WHERE id=1`).run(ok?0:failures,status||null,state,circuitUntil);
  return {ok,state,circuitUntil};
}
function safeResult(r){
  return {
    ok:!!r.ok,status:Number(r.status||0)||0,
    contentType:String(r.contentType||"").slice(0,160)||null,
    size:Number(r.size||0)||0,
    fileName:String(r.fileName||"").slice(0,260)||null,
    dataKeys:Array.isArray(r.dataKeys)?r.dataKeys.slice(0,60).map(String):undefined,
    error:r.error?String(r.error).slice(0,1000):undefined
  };
}
function observedRequest(pathName){
  const r=db.prepare("SELECT sample_request_json FROM uyap_endpoint_observations WHERE path=? ORDER BY last_seen_at DESC LIMIT 1").get(pathName);
  if(!r?.sample_request_json) throw new Error("UYAP istek şeması henüz gözlemlenmedi: "+pathName);
  return JSON.parse(r.sample_request_json);
}
function parseYmd(s){
  const m=String(s||"").match(/^(\d{4})-(\d{2})-(\d{2})$/); if(!m)throw new Error("Tarih YYYY-MM-DD olmalı");
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));
  if(Number.isNaN(d.getTime()))throw new Error("Geçersiz tarih"); return d;
}
function fmtUyapDate(d){return d.getUTCDate()+"."+(d.getUTCMonth()+1)+"."+d.getUTCFullYear()}
function enqueueCaseDiscovery({yargiTypes=null,statuses=[0,1],syncDocuments=false}={}){
  const types=Array.isArray(yargiTypes)&&yargiTypes.length?yargiTypes:Array.from({length:31},(_,i)=>i);
  const ids=[];
  for(const y of types){
    ids.push(enqueue({commandType:"fetch_json",endpointKey:"case.units",
      payload:{query:{},body:{yargiTuru:String(y)},context:{discovery:true,stage:"units",yargiTuru:Number(y),statuses, syncDocuments:Boolean(syncDocuments)}},
      priority:20}));
  }
  return {yargiTypes:types,statuses,commandIds:ids};
}
function enqueueCaseSearchPage({yargiTuru,birimTuru2,dosyaDurumKod,pageNumber=1,syncDocuments=false}){
  return enqueue({commandType:"fetch_json",endpointKey:"case.search",
    payload:{query:{},body:{dosyaDurumKod:Number(dosyaDurumKod),pageSize:500,pageNumber:Number(pageNumber),birimId:"",birimTuru2:String(birimTuru2),birimTuru3:String(yargiTuru)},
      context:{discovery:true,stage:"cases",yargiTuru:Number(yargiTuru),birimTuru2:String(birimTuru2),dosyaDurumKod:Number(dosyaDurumKod),pageNumber:Number(pageNumber),syncDocuments:Boolean(syncDocuments)}},
    priority:20});
}
function provinceCode(x){
  if(x==null)return null;
  if(typeof x==="number"||typeof x==="string"){const n=Number(x);return Number.isFinite(n)&&n>=1&&n<=81?n:null}
  for(const k of ["ilKodu","ilKod","kod","id","value","plakaKodu"]){
    const n=Number(x?.[k]); if(Number.isFinite(n)&&n>=1&&n<=81)return n;
  }
  return null;
}
function cbsUnitId(x){
  for(const k of ["birimId","id","birimKodu","kod","tablo"]){
    const v=x?.[k]; if(v!==undefined&&v!==null&&String(v).trim())return String(v);
  }
  return null;
}
function enqueueCbsDiscovery({statuses=[0,1],syncDocuments=false}={}){
  const id=enqueue({commandType:"fetch_json",endpointKey:"cbs.provinces",
    payload:{query:{},body:{},context:{discovery:true,stage:"cbs_provinces",statuses,syncDocuments:Boolean(syncDocuments)}},
    priority:20});
  return {commandId:id,statuses};
}
function enqueueCbsUnits(ilKodu,{statuses=[0,1],syncDocuments=false}={}){
  return enqueue({commandType:"fetch_json",endpointKey:"cbs.units",
    payload:{query:{},body:{ilKodu:Number(ilKodu)},context:{discovery:true,stage:"cbs_units",ilKodu:Number(ilKodu),statuses,syncDocuments:Boolean(syncDocuments)}},
    priority:20});
}
function enqueueCbsSearchPage({ilKodu,birimId,dosyaDurumKod,pageNumber=1,syncDocuments=false}){
  return enqueue({commandType:"fetch_json",endpointKey:"cbs.search",
    payload:{query:{},body:{dosyaDurumKod:Number(dosyaDurumKod),pageSize:500,pageNumber:Number(pageNumber),birimId:"",birimTuru2:String(birimId),birimTuru3:"3"},
      context:{discovery:true,stage:"cbs_cases",ilKodu:Number(ilKodu),birimId:String(birimId),dosyaDurumKod:Number(dosyaDurumKod),pageNumber:Number(pageNumber),syncDocuments:Boolean(syncDocuments)}},
    priority:20});
}
function enqueueHearingRange(startYmd,endYmd){
  const start=parseYmd(startYmd),end=parseYmd(endYmd); if(end<start)throw new Error("Bitiş tarihi başlangıçtan önce olamaz");
  const ids=[]; let cursor=new Date(start);
  while(cursor<=end){
    const winEnd=new Date(cursor); winEnd.setUTCDate(winEnd.getUTCDate()+29); if(winEnd>end)winEnd.setTime(end.getTime());
    ids.push(enqueue({commandType:"fetch_json",endpointKey:"hearing.search",payload:{query:{},body:{baslangicTarihi:fmtUyapDate(cursor),bitisTarihi:fmtUyapDate(winEnd)}},priority:12}));
    cursor=new Date(winEnd); cursor.setUTCDate(cursor.getUTCDate()+1);
  }
  return {start:startYmd,end:endYmd,windows:ids.length,commandIds:ids};
}
function isoDate(s){const m=String(s||"").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);return m?m[3]+"-"+m[2]+"-"+m[1]:null}
function ensureCaseFromHearing(h){
  const externalId="uyap:case:"+String(h?.birimId||"")+":"+String(h?.dosyaNo||"");
  let c=db.prepare("SELECT * FROM cases WHERE external_id=?").get(externalId);
  if(!c){
    const r=db.prepare(`INSERT INTO cases(external_id,court,court_file_no,case_type,status,last_activity_at,synced_at,office_file_id,uyap_dosya_id,uyap_birim_id,uyap_metadata_json)
      VALUES(?,?,?,?,?,?,datetime('now'),NULL,?,?,?)`).run(externalId,h?.yerelBirimAd||null,h?.dosyaNo||null,h?.dosyaTurKodAciklama||null,"open",h?.tarihSaat||null,String(h?.dosyaId||"")||null,String(h?.birimId||"")||null,JSON.stringify(h||{}));
    c=db.prepare("SELECT * FROM cases WHERE id=?").get(Number(r.lastInsertRowid));
  }else{
    db.prepare(`UPDATE cases SET court=?,court_file_no=?,case_type=?,last_activity_at=?,uyap_dosya_id=?,uyap_birim_id=?,uyap_metadata_json=?,synced_at=datetime('now') WHERE id=?`)
      .run(h?.yerelBirimAd||c.court,h?.dosyaNo||c.court_file_no,h?.dosyaTurKodAciklama||c.case_type,h?.tarihSaat||c.last_activity_at,String(h?.dosyaId||c.uyap_dosya_id||"")||null,String(h?.birimId||c.uyap_birim_id||"")||null,JSON.stringify(h||{}),c.id);
  }
  return c;
}
function upsertHearings(rows){
  const list=Array.isArray(rows)?rows:[];
  let added=0,updated=0;
  for(const h of list){
    const c=ensureCaseFromHearing(h);
    const ext=String(h?.kayitId||crypto.createHash("sha256").update([h?.birimId,h?.dosyaNo,h?.tarihSaat].join("|")).digest("hex"));
    const notes=JSON.stringify({dosyaTaraflari:h?.dosyaTaraflari||[],islemSonucuAciklama:h?.islemSonucuAciklama||null,talepDurumu:h?.talepDurumu||null});
    const exists=db.prepare("SELECT id FROM hearings WHERE external_id=?").get(ext);
    if(exists){
      db.prepare("UPDATE hearings SET case_id=?,starts_at=?,location=?,hearing_type=?,notes=? WHERE id=?")
        .run(c.id,h?.tarihSaat||null,h?.yerelBirimAd||null,h?.islemTuruAciklama||"Duruşma",notes,exists.id);updated++;
    }else{
      db.prepare("INSERT INTO hearings(case_id,external_id,starts_at,location,hearing_type,notes) VALUES(?,?,?,?,?,?)")
        .run(c.id,ext,h?.tarihSaat||null,h?.yerelBirimAd||null,h?.islemTuruAciklama||"Duruşma",notes);added++;
    }
  }
  return {total:list.length,added,updated};
}
function isMediationCaseMeta(r){
  return /arabuluculuk/i.test(String(r?.birimAdi||"")+" "+String(r?.dosyaTur||""));
}
function reconcileMediationRelation(caseId,r){
  if(!caseId||!isMediationCaseMeta(r))return;
  const status=String(r?.dosyaDurum||"").trim();
  const isClosed=/kapal/i.test(status)||Number(r?.dosyaDurumKod)===1;
  if(!isClosed){
    db.prepare("DELETE FROM case_relations WHERE source_case_id=? AND relation_type='related_mediation' AND target_case_id IS NULL").run(Number(caseId));
    return;
  }
  const meta={
    mediationCaseNo:r?.dosyaNo||null,
    mediationCourt:r?.birimAdi||null,
    mediationType:r?.dosyaTur||null,
    isDavaDosyasiAcilmisMi:r?.isDavaDosyasiAcilmisMi===true,
    uyap:r||{}
  };
  db.prepare(`INSERT INTO case_relations(source_case_id,target_case_id,relation_type,relation_status,source,metadata_json,created_at,updated_at)
    VALUES(?,NULL,'related_mediation','unresolved','uyap',?,datetime('now'),datetime('now'))
    ON CONFLICT(source_case_id,relation_type) DO UPDATE SET
      metadata_json=excluded.metadata_json,
      relation_status=CASE WHEN case_relations.target_case_id IS NULL THEN 'unresolved' ELSE case_relations.relation_status END,
      updated_at=datetime('now')`).run(Number(caseId),JSON.stringify(meta));
}
function upsertCasesFromSearch(data){
  const list=Array.isArray(data?.[0])?data[0]:(Array.isArray(data)?data:[]);
  let added=0,updated=0;
  for(const r of list){
    if(!r?.birimId||!r?.dosyaNo)continue;
    const externalId="uyap:case:"+String(r.birimId)+":"+String(r.dosyaNo);
    const exists=db.prepare("SELECT * FROM cases WHERE external_id=?").get(externalId);
    const status=String(r.dosyaDurum||"").trim()||"unknown";
    if(exists){
      db.prepare(`UPDATE cases SET court=?,court_file_no=?,case_type=?,status=?,uyap_dosya_id=?,uyap_birim_id=?,uyap_metadata_json=?,synced_at=datetime('now') WHERE id=?`)
        .run(r.birimAdi||exists.court,r.dosyaNo||exists.court_file_no,r.dosyaTur||exists.case_type,status,String(r.dosyaId||exists.uyap_dosya_id||"")||null,String(r.birimId||exists.uyap_birim_id||"")||null,JSON.stringify(r),exists.id);
      reconcileMediationRelation(exists.id,r);
      updated++;
    }else{
      const ins=db.prepare(`INSERT INTO cases(external_id,court,court_file_no,case_type,status,synced_at,office_file_id,uyap_dosya_id,uyap_birim_id,uyap_metadata_json)
        VALUES(?,?,?,?,?,datetime('now'),NULL,?,?,?)`)
        .run(externalId,r.birimAdi||null,r.dosyaNo||null,r.dosyaTur||null,status,String(r.dosyaId||"")||null,String(r.birimId||"")||null,JSON.stringify(r));
      reconcileMediationRelation(Number(ins.lastInsertRowid),r);
      added++;
    }
  }
  return {total:list.length,added,updated};
}
function remoteStableKey(d){
  const raw=[d?.birimEvrakNo,d?.onaylandigiTarih,d?.tur,d?.tip,d?.gonderenYerKisi,d?.gonderenDosyaNo,d?.aciklama].map(x=>String(x??"").trim()).join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}
function remoteStatusRank(s){
  return ({filed:100,summarized:95,indexed:90,downloaded:80,skipped:70,review:60,download_queued:50,discovered:40}[String(s||"")]||0);
}
function mergeRemoteDocumentRows(targetId,sourceId){
  if(!targetId||!sourceId||Number(targetId)===Number(sourceId))return Number(targetId||sourceId||0);
  const target=db.prepare("SELECT * FROM uyap_remote_documents WHERE id=?").get(Number(targetId));
  const source=db.prepare("SELECT * FROM uyap_remote_documents WHERE id=?").get(Number(sourceId));
  if(!target||!source)return Number(target?.id||source?.id||0);

  db.prepare("UPDATE correspondence_requests SET request_document_id=? WHERE request_document_id=?").run(target.id,source.id);
  db.prepare("UPDATE correspondence_requests SET response_document_id=? WHERE response_document_id=?").run(target.id,source.id);
  db.prepare("UPDATE evidence_links SET remote_document_id=? WHERE remote_document_id=?").run(target.id,source.id);
  db.prepare(`INSERT OR IGNORE INTO correspondence_match_suggestions
    (correspondence_id,asset_id,remote_document_id,score,reasons_json,status,created_at,decided_at,decided_by)
    SELECT correspondence_id,asset_id,?,score,reasons_json,status,created_at,decided_at,decided_by
    FROM correspondence_match_suggestions WHERE remote_document_id=?`).run(target.id,source.id);
  db.prepare("DELETE FROM correspondence_match_suggestions WHERE remote_document_id=?").run(source.id);

  db.prepare(`UPDATE uyap_command_queue SET status='cancelled',finished_at=datetime('now'),error='merged_duplicate_remote_document'
    WHERE command_type='download_document' AND status IN ('queued','running','failed')
      AND ${downloadCommandMatchesRemoteSql()}`).run(Number(source.id));

  let status=remoteStatusRank(source.status)>remoteStatusRank(target.status)?source.status:target.status;
  const localAsset=target.local_asset_id||source.local_asset_id||null;
  const filedPath=target.filed_path||source.filed_path||null;
  const stagingPath=target.staging_path||source.staging_path||null;
  if(filedPath)status="filed";
  else if(localAsset&&remoteStatusRank(status)<remoteStatusRank("indexed"))status="indexed";
  else if(stagingPath&&remoteStatusRank(status)<remoteStatusRank("downloaded"))status="downloaded";

  db.prepare(`UPDATE uyap_remote_documents SET
    local_asset_id=?,remote_hash=?,staging_path=?,filed_path=?,status=?,
    downloaded_at=COALESCE(downloaded_at,?),filed_at=COALESCE(filed_at,?),
    is_baseline=MAX(is_baseline,?),first_seen_at=CASE WHEN first_seen_at<=? THEN first_seen_at ELSE ? END,
    last_seen_at=datetime('now')
    WHERE id=?`).run(
      localAsset,target.remote_hash||source.remote_hash||null,stagingPath,filedPath,status,
      source.downloaded_at||null,source.filed_at||null,Number(source.is_baseline||0),
      source.first_seen_at||target.first_seen_at,target.first_seen_at,target.id
    );
  db.prepare("DELETE FROM uyap_remote_documents WHERE id=?").run(source.id);
  return target.id;
}
function upsertRemoteList(caseId,data,{baseline=false}={}){
  let docs=[];
  if(Array.isArray(data?.tumEvraklar)) docs=data.tumEvraklar;
  else if(data?.tumEvraklar&&typeof data.tumEvraklar==="object"){
    for(const [group,items] of Object.entries(data.tumEvraklar)){
      if(!Array.isArray(items))continue;
      for(const item of items) docs.push({...item,__uyapGroup:group});
    }
  }else if(Array.isArray(data?.son20Evrak)) docs=data.son20Evrak;
  const ins=db.prepare(`INSERT INTO uyap_remote_documents(case_id,remote_document_id,stable_key,remote_title,document_type,document_date,original_file_name,status,is_baseline,metadata_json)
    VALUES(?,?,?,?,?,?,?,'discovered',?,?)`);
  const upd=db.prepare(`UPDATE uyap_remote_documents SET stable_key=?,remote_document_id=?,remote_title=?,document_type=?,document_date=?,original_file_name=?,
    last_seen_at=datetime('now'),metadata_json=? WHERE id=?`);
  let added=0,updated=0,merged=0;
  for(const d of docs){
    const remoteId=String(d?.evrakId||""); if(!remoteId)continue;
    const stable=remoteStableKey(d);
    let byStable=db.prepare("SELECT * FROM uyap_remote_documents WHERE case_id=? AND stable_key=?").get(caseId,stable);
    let byRemote=db.prepare("SELECT * FROM uyap_remote_documents WHERE case_id=? AND remote_document_id=?").get(caseId,remoteId);
    if(byStable&&byRemote&&Number(byStable.id)!==Number(byRemote.id)){
      const survivorId=mergeRemoteDocumentRows(byRemote.id,byStable.id);
      byRemote=db.prepare("SELECT * FROM uyap_remote_documents WHERE id=?").get(survivorId);
      byStable=byRemote;
      merged++;
    }
    const exists=byStable||byRemote;
    const title=[d.tur,d.aciklama].filter(x=>x&&x!=="null null").join(" · ");
    const fileName=(d.tur||"UYAP Evrak")+" "+(d.onaylandigiTarih||"")+".pdf";
    if(exists){
      let oldMeta={};try{oldMeta=JSON.parse(exists.metadata_json||"{}")}catch{}
      const tokenChanged=String(exists.remote_document_id||"")!==remoteId||
        String(oldMeta.dosyaId||"")!==String(d?.dosyaId||"");
      upd.run(stable,remoteId,title||null,d.tur||null,isoDate(d.onaylandigiTarih),fileName,JSON.stringify(d),exists.id);
      if(tokenChanged){
        const cancelled=db.prepare(`UPDATE uyap_command_queue SET status='cancelled',finished_at=datetime('now'),error='stale_remote_metadata'
          WHERE command_type='download_document' AND status IN ('queued','failed')
            AND ${downloadCommandMatchesRemoteSql()}`).run(Number(exists.id)).changes;
        if(cancelled>0&&!exists.local_asset_id) db.prepare("UPDATE uyap_remote_documents SET status='discovered',last_seen_at=datetime('now') WHERE id=?").run(exists.id);
      }
      updated++;
    }else{
      ins.run(caseId,remoteId,stable,title||null,d.tur||null,isoDate(d.onaylandigiTarih),fileName,baseline?1:0,JSON.stringify(d));
      added++;
    }
  }
  return {total:docs.length,added,updated,merged};
}
function caseNoNorm(v){
  const m=String(v||"").match(/(20\d{2})\s*\/\s*(\d+)/);
  return m?m[1]+"/"+String(Number(m[2])):nrm(v);
}
function courtNorm(v){
  return nrm(v).replace(/\b(mahkemesi|mahkeme|hakimligi|hakimlik|dairesi|daire)\b/g," ").replace(/\s+/g," ").trim();
}
function linkedUyapCase(caseId){
  const c=db.prepare("SELECT * FROM cases WHERE id=?").get(Number(caseId));
  if(!c)return null;
  if(c.uyap_dosya_id)return c;
  const no=caseNoNorm(c.court_file_no); if(!no)return c;
  const court=courtNorm(c.court);
  const hits=db.prepare("SELECT * FROM cases WHERE id<>? AND uyap_dosya_id IS NOT NULL").all(c.id)
    .filter(x=>caseNoNorm(x.court_file_no)===no&&courtNorm(x.court)===court);
  return hits.length===1?hits[0]:c;
}
function cases(){
  const rows=db.prepare(`SELECT c.id,c.court,c.court_file_no,c.case_type,c.status,c.client_name,c.last_activity_at,c.office_file_id,c.uyap_dosya_id,c.external_id,
    (SELECT file_no FROM office_files of WHERE of.id=c.office_file_id) office_file_no,
    (SELECT GROUP_CONCAT(p.name,' | ') FROM parties p WHERE p.case_id=c.id) party_names,
    COUNT(r.id) remote_count,SUM(CASE WHEN r.local_asset_id IS NOT NULL THEN 1 ELSE 0 END) indexed_count
    FROM cases c LEFT JOIN uyap_remote_documents r ON r.case_id=c.id
    GROUP BY c.id ORDER BY COALESCE(c.last_activity_at,c.synced_at) DESC,c.id DESC`).all();
  const rels=db.prepare(`SELECT cr.*,s.court source_court,s.court_file_no source_case_no,s.case_type source_case_type,s.status source_status
    FROM case_relations cr JOIN cases s ON s.id=cr.source_case_id
    WHERE cr.relation_type='related_mediation'`).all();
  const hiddenMediationIds=new Set();
  for(const rel of rels){
    if(!rel.target_case_id)continue;
    const target=rows.find(x=>Number(x.id)===Number(rel.target_case_id));
    if(!target)continue;
    target.related_cases=target.related_cases||[];
    target.related_cases.push({
      relationType:'related_mediation',
      relationStatus:rel.relation_status,
      caseId:rel.source_case_id,
      court:rel.source_court,
      courtFileNo:rel.source_case_no,
      caseType:rel.source_case_type,
      status:rel.source_status
    });
    hiddenMediationIds.add(Number(rel.source_case_id));
  }
  const linkedIds=new Set();
  for(const r of rows){
    if(!String(r.external_id||"").startsWith("legacy:"))continue;
    const linked=linkedUyapCase(r.id);
    if(!linked||linked.id===r.id)continue;
    const counts=db.prepare("SELECT COUNT(*) remote_count,SUM(CASE WHEN local_asset_id IS NOT NULL THEN 1 ELSE 0 END) indexed_count FROM uyap_remote_documents WHERE case_id=?").get(linked.id);
    r.remote_count=Number(counts?.remote_count||0);
    r.indexed_count=Number(counts?.indexed_count||0);
    r.uyap_dosya_id=linked.uyap_dosya_id;
    r.uyap_case_id=linked.id;
    linkedIds.add(linked.id);
  }
  return rows.filter(r=>!hiddenMediationIds.has(Number(r.id))&&!(linkedIds.has(r.id)&&String(r.external_id||"").startsWith("uyap:")));
}
function remoteDocuments(caseId){
  const c=linkedUyapCase(caseId);if(!c)return [];
  return db.prepare("SELECT * FROM uyap_remote_documents WHERE case_id=? ORDER BY COALESCE(document_date,'') DESC,id DESC").all(Number(c.id));
}
function enqueueCaseDocumentSync(caseId,{priority=10,purpose="",source=""}={}){
  const c=linkedUyapCase(caseId); if(!c)throw new Error("UYAP case bulunamadı");
  if(!c.uyap_dosya_id)throw new Error("Dosyanın UYAP dosyaId bilgisi yok; önce dosya sorgusu yapılmalı");
  const active=db.prepare("SELECT id,priority,payload_json FROM uyap_command_queue WHERE endpoint_key='document.list' AND status IN ('queued','running') AND payload_json LIKE ? ORDER BY id LIMIT 1")
    .get('%"caseId":'+Number(c.id)+'%');
  if(active?.id){
    if(purpose||Number(priority)<Number(active.priority||999)){
      let p={};try{p=JSON.parse(active.payload_json||"{}")}catch{}
      p.context={...(p.context||{}),caseId:Number(c.id)};
      p.query=p.query||{};
      p.body={...(p.body||{}),dosyaId:uyapOpaqueId(c.uyap_dosya_id),pageNumber:Number(p.body?.pageNumber||1)};
      if(purpose)p.context.purpose=String(purpose);
      if(source)p.context.source=String(source);
      db.prepare("UPDATE uyap_command_queue SET payload_json=?,priority=?,not_before_ms=0 WHERE id=?")
        .run(JSON.stringify(p),Math.min(Number(active.priority||priority),Number(priority)),active.id);
    }
    return Number(active.id);
  }
  const context={caseId:Number(c.id)};
  if(purpose)context.purpose=String(purpose);
  if(source)context.source=String(source);
  return enqueue({commandType:"fetch_json",endpointKey:"document.list",payload:{query:{},body:{dosyaId:uyapOpaqueId(c.uyap_dosya_id),pageNumber:1},context},priority:Number(priority)||10});
}
function documentDownloadPolicy(d){
  const x=nrm([d?.document_type,d?.remote_title,d?.original_file_name].filter(Boolean).join(" "));
  // Mali evraklar içerikten özetlenip kaynak dosya temizlenecek.
  if(/reddiyat|tahsilat|tahsil makbuz|banka odeme dekontu/.test(x)) return {action:"summarize",reason:"mali_ozet"};

  // Kesin teknik/operasyonel UYAP evrakları: açıklamasında başka kelime geçse de indirme.
  if(/kapali tebligat|acik tebligat|e teblig mazbata|teblig mazbata|vekalet pulu makbuzu|sayman mutemet alindisi|talimat gonderme yazisi|talimat ust yazisi|talimat otomatik tevzi|talimat dosyasinin emniyete|gelen talimat istegi|talimat sonuc yazisi|hedef sure formu|tevzi formu|dava acilis formu|bos genel muzekkere|sanik karar takip formu|ptt tebligat sorgulamasi|gonderme raporu|harc tahsil muzekkeresi|harc masraf tahsil|masraf makbuzu|sarf karari|goruldu evraki|e durusma talebi|dizi pusulasi|ceza fisi|adli sicil sabika kaydi|nufus kayit ornegi/.test(x))
    return {action:"skip",reason:"operasyonel_evrak"};

  // Hukuki çalışma/arşiv değeri yüksek evraklar.
  if(/dava dilek|cevap dilek|beyan dilek|savunma dilek|delil dilek|mazeret dilek|talep evrak|avukat portal genel taleb|avukat portal haciz taleb|itiraz dilek|istinaf|temyiz|feragat dilek|sikayet dilek|suc duyur|vekillikten cekilme|dosyanin yeniden isleme|bilirkisi rapor|adli tip rapor|sgk hizmet dokumu|gerekceli karar|takipsizlik karar|yd karar|birlestirme karar|iddianame|fezleke|ifade tutan|durusma zapt|on inceleme zapt|tensip zapt|hukuk genel tutanak|vekaletname|yetki belgesi|muzekkere cevab|kurum ve kuruluslardan gelen cevap|bankadan gelen cevap|haciz ihbarnamesi cevab|serh .*cevap evraki|takip talebi|odeme icra emri|takibin dayanagi belge|kesinlesme serh|sikayetci beyan|sanik beyan|magdur beyan|tanik beyan/.test(x))
    return {action:"archive",reason:"hukuki_deger"};

  // Başlığı tek başına içeriği anlatmayan evrakları otomatik indirme.
  return {action:"review",reason:"manuel_inceleme"};
}

function caseContentDownloadBlocked(caseId){
  const c=db.prepare("SELECT id,office_file_id,client_name FROM cases WHERE id=?").get(Number(caseId));
  if(!c)return false;
  if(Number(c.office_file_id)===8)return true;
  const names=[c.client_name,...db.prepare("SELECT name FROM parties WHERE case_id=?").all(Number(caseId)).map(x=>x.name)];
  return names.some(x=>nrm(x).includes("mahsun ozturk"));
}
function downloadCommandMatchesRemoteSql(){
  return "json_valid(payload_json)=1 AND CAST(json_extract(payload_json,'$.context.remoteDocumentDbId') AS INTEGER)=?";
}
function downloadCommandMatchesCaseSql(){
  return "json_valid(payload_json)=1 AND CAST(json_extract(payload_json,'$.context.caseId') AS INTEGER)=?";
}
function activeCaseDownloadCount(caseId){
  return Number(db.prepare(`SELECT count(*) n FROM uyap_command_queue
    WHERE command_type='download_document' AND status IN ('queued','running')
      AND ${downloadCommandMatchesCaseSql()}`).get(Number(caseId))?.n||0);
}
function enqueueRemoteDocumentDownload(remoteDbId){
  if(sessionState().state==="login_required")return null;
  const d=db.prepare("SELECT * FROM uyap_remote_documents WHERE id=?").get(Number(remoteDbId)); if(!d)throw new Error("UYAP evrakı bulunamadı");
  if(d.local_asset_id||d.filed_path||d.staging_path){
    if(d.local_asset_id&&["discovered","download_queued","downloaded"].includes(String(d.status||""))){
      db.prepare("UPDATE uyap_remote_documents SET status=CASE WHEN filed_path IS NOT NULL THEN 'filed' ELSE 'indexed' END,last_seen_at=datetime('now') WHERE id=?").run(d.id);
    }
    return null;
  }
  const existingCommand=db.prepare(`SELECT id FROM uyap_command_queue
    WHERE command_type='download_document' AND status IN ('queued','running')
      AND ${downloadCommandMatchesRemoteSql()}
    ORDER BY id DESC LIMIT 1`).get(Number(d.id));
  if(existingCommand)return null;
  if(caseContentDownloadBlocked(d.case_id)){
    let meta={};try{meta=JSON.parse(d.metadata_json||"{}")}catch{}
    meta.bonoPolicy={action:"skip",reason:"mahsun_ozturk_icerik_indirme_istisnasi"};
    db.prepare("UPDATE uyap_remote_documents SET status='skipped',metadata_json=?,last_seen_at=datetime('now') WHERE id=?").run(JSON.stringify(meta),d.id);
    return null;
  }
  if(["download_queued","downloaded","indexed","filed","summarized","skipped","review"].includes(String(d.status||"")))return null;
  const policy=documentDownloadPolicy(d);
  if(policy.action==="skip"||policy.action==="review"){
    const meta=JSON.parse(d.metadata_json||"{}");
    meta.bonoPolicy=policy;
    db.prepare("UPDATE uyap_remote_documents SET status=?,metadata_json=?,last_seen_at=datetime('now') WHERE id=?")
      .run(policy.action==="skip"?"skipped":"review",JSON.stringify(meta),d.id);
    return null;
  }
  if(d.stable_key){
    const dup=db.prepare("SELECT local_asset_id,remote_hash,staging_path FROM uyap_remote_documents WHERE case_id=? AND stable_key=? AND local_asset_id IS NOT NULL ORDER BY id LIMIT 1").get(d.case_id,d.stable_key);
    if(dup?.local_asset_id){
      db.prepare("UPDATE uyap_remote_documents SET local_asset_id=?,remote_hash=?,status='indexed',last_seen_at=datetime('now') WHERE id=?")
        .run(dup.local_asset_id,dup.remote_hash||null,d.id);
      return null;
    }
  }
  const m=JSON.parse(d.metadata_json||"{}"); if(!m.evrakId||!m.dosyaId)throw new Error("UYAP evrak parametreleri eksik");
  const clean=String(d.remote_title||d.document_type||"UYAP_Evrak").replace(/[\\/:*?"<>|]+/g,"_").slice(0,120);
  const sourceName=String(m.dosyaAdi||m.fileName||m.evrakAdi||"").trim();
  const sourceExt=(sourceName.match(/\.[a-z0-9]{2,6}$/i)||[])[0]||"";
  const id=enqueue({commandType:"download_document",endpointKey:"document.pdf",payload:{query:{evrakId:uyapOpaqueId(m.evrakId),dosyaId:uyapOpaqueId(m.dosyaId)},fileName:clean+sourceExt,context:{caseId:d.case_id,remoteDocumentDbId:d.id}},priority:8});
  db.prepare("UPDATE uyap_remote_documents SET status='download_queued',last_seen_at=datetime('now') WHERE id=?").run(d.id);
  return id;
}
function caseDownloadSummary(caseId){
  const c=linkedUyapCase(caseId); if(!c)throw new Error("UYAP case bulunamadı");
  const rows=db.prepare("SELECT * FROM uyap_remote_documents WHERE case_id=? ORDER BY COALESCE(document_date,'') DESC,id DESC").all(Number(c.id));
  let existing=0,queued=0,missingDownloadable=0,review=0,skipped=0,summarize=0;
  for(const d of rows){
    if(d.local_asset_id||d.filed_path||d.staging_path||["downloaded","indexed","filed","summarized"].includes(String(d.status||""))){existing++;continue}
    if(String(d.status||"")==="download_queued"){queued++;continue}
    if(String(d.status||"")==="skipped"){skipped++;continue}
    if(String(d.status||"")==="review"){review++;continue}
    if(String(d.status||"")!=="discovered")continue;
    const p=documentDownloadPolicy(d);
    if(p.action==="archive")missingDownloadable++;
    else if(p.action==="summarize"){missingDownloadable++;summarize++}
    else if(p.action==="review")review++;
    else if(p.action==="skip")skipped++;
  }
  const lastSync=db.prepare(`SELECT finished_at FROM uyap_command_queue
    WHERE endpoint_key='document.list' AND status='completed' AND payload_json LIKE ?
    ORDER BY id DESC LIMIT 1`).get('%"caseId":'+Number(c.id)+'%')?.finished_at||null;
  const session=sessionState();
  const activeCommands=activeCaseDownloadCount(c.id);
  return {
    caseId:Number(c.id),requestedCaseId:Number(caseId),total:rows.length,existing,queued,
    missingDownloadable,review,skipped,summarize,lastSync,
    batchSize:200,activeCommands,capacity:Math.max(0,200-activeCommands),
    manualDownloadPaused:session.manualDownloadPaused,
    downloadState:session.documentDownloadState,
    downloadReason:session.documentDownloadReason
  };
}
function enqueuePendingDownloads(caseId,limit=200){
  const c=linkedUyapCase(caseId); if(!c)throw new Error("UYAP case bulunamadı");
  limit=Math.max(1,Math.min(200,Number(limit)||200));
  let active=0,capacity=0,queued=0,skipped=0,review=0;
  let tx=false;
  try{
    // Aynı case için eşzamanlı batch çağrılarını SQLite writer lock ile sırala.
    // Böylece aktif queued/running toplamı hiçbir anda 200'ü aşmaz.
    db.exec("BEGIN IMMEDIATE"); tx=true;
    active=activeCaseDownloadCount(c.id);
    capacity=Math.max(0,200-active);
    const batchLimit=Math.min(limit,capacity);
    if(batchLimit>0){
      const rows=db.prepare("SELECT id FROM uyap_remote_documents WHERE case_id=? AND local_asset_id IS NULL AND status='discovered' ORDER BY COALESCE(document_date,'') DESC,id DESC").all(Number(c.id));
      for(const r of rows){
        if(queued>=batchLimit)break;
        const before=db.prepare("SELECT status FROM uyap_remote_documents WHERE id=?").get(r.id)?.status;
        try{if(enqueueRemoteDocumentDownload(r.id))queued++}catch{}
        const after=db.prepare("SELECT status FROM uyap_remote_documents WHERE id=?").get(r.id)?.status;
        if(before!==after&&after==="skipped")skipped++;
        if(before!==after&&after==="review")review++;
      }
    }
    db.exec("COMMIT"); tx=false;
  }catch(e){
    if(tx){try{db.exec("ROLLBACK")}catch{}}
    throw e;
  }
  return {
    active:Number(active||0),capacity:Number(capacity||0),queued,skipped,review,limit,
    activeAfter:activeCaseDownloadCount(c.id),
    summary:caseDownloadSummary(c.id)
  };
}
function ingestDownloadedDocument(commandId){
  const q=db.prepare("SELECT * FROM uyap_command_queue WHERE id=?").get(Number(commandId)); if(!q)throw new Error("UYAP komutu bulunamadı");
  if(String(q.command_type||"")!=="download_document")throw new Error("UYAP ingest yalnız download_document komutları için geçerli");
  if(String(q.status||"")!=="completed")throw new Error("UYAP ingest yalnız completed indirme komutları için geçerli: "+String(q.status||"unknown"));
  const payload=q.payload_json?JSON.parse(q.payload_json):{},meta=q.result_meta_json?JSON.parse(q.result_meta_json):{};
  const remoteDbId=Number(payload?.context?.remoteDocumentDbId||0); if(!remoteDbId)throw new Error("Remote evrak bağlamı eksik");
  const remote=db.prepare("SELECT * FROM uyap_remote_documents WHERE id=?").get(remoteDbId); if(!remote)throw new Error("Remote evrak bulunamadı");
  const downloads=path.join(process.env.USERPROFILE||"C:\\Users\\omera","Downloads");
  const reported=String(meta.fileName||"");
  const candidates=[reported,"BONO_UYAP_"+reported].filter(Boolean).map(n=>path.join(downloads,n));
  let src=candidates.find(x=>fs.existsSync(x))||null;
  if(!src){
    const ext=path.extname(reported);
    const base=ext?reported.slice(0,-ext.length):reported;
    const escaped=base.replace(/[.*+?^$()|[\\]\\{}]/g,"\\$&");
    const duplicateRe=new RegExp("^"+escaped+" \\([0-9]+\\)$","i");
    const hits=fs.readdirSync(downloads).filter(n=>{
      if(n.toLowerCase().endsWith(".crdownload"))return false;
      const nExt=path.extname(n);
      if(ext&&nExt.toLowerCase()!==ext.toLowerCase())return false;
      const stem=path.basename(n,nExt).replace(/^BONO_UYAP_/i,"");
      return stem===base||duplicateRe.test(stem);
    }).map(n=>({n,t:fs.statSync(path.join(downloads,n)).mtimeMs})).sort((a,b)=>b.t-a.t);
    if(!hits.length)throw new Error("İndirilen UYAP belgesi bulunamadı: "+reported); src=path.join(downloads,hits[0].n);
  }
  const raw=fs.readFileSync(src);
  const probe=raw.subarray(0,Math.min(raw.length,4096)).toString("utf8").toLowerCase();
  const isPortalLogin=probe.includes("uyap avukat bilgi sistemi")&&(probe.includes("avukat portal giriş sayfası")||probe.includes("<div id=\"root\"></div>"));
  if(isPortalLogin){
    let mm={};try{mm=JSON.parse(remote.metadata_json||"{}")}catch{}
    mm.lastDownloadError={type:"uyap_portal_login_html",at:new Date().toISOString(),reported};
    if(remote.local_asset_id){
      db.prepare("UPDATE uyap_remote_documents SET metadata_json=?,last_seen_at=datetime('now') WHERE id=?")
        .run(JSON.stringify(mm),remote.id);
    }else{
      db.prepare("UPDATE uyap_remote_documents SET staging_path=NULL,filed_path=NULL,remote_hash=NULL,status='discovered',metadata_json=?,last_seen_at=datetime('now') WHERE id=?")
        .run(JSON.stringify(mm),remote.id);
    }
    try{
      const low=path.resolve(src).toLowerCase(),dl=path.resolve(downloads).toLowerCase()+path.sep.toLowerCase();
      if(low.startsWith(dl))fs.unlinkSync(src);
    }catch{}
    setDocumentDownloadState("paused_viewer_html","uyap_portal_login_html");
    return {remoteDocumentId:remote.id,caseId:remote.case_id,stagingPath:null,sourcePath:src,invalidDownload:true,reason:"uyap_portal_login_html"};
  }
  const dir=path.join(__dirname,"..","data","staging","uyap","case_"+remote.case_id); fs.mkdirSync(dir,{recursive:true});
  const sourceExt=path.extname(src)||path.extname(reported)||".bin";
  const safe=String(remote.document_date||"tarihsiz")+"_"+String(remote.document_type||"UYAP_Evrak").replace(/[\\/:*?"<>|]+/g,"_")+"_"+remote.id+sourceExt;
  const dest=path.join(dir,safe); fs.writeFileSync(dest,raw);
  const sha=crypto.createHash("sha256").update(raw).digest("hex");
  db.prepare("UPDATE uyap_remote_documents SET staging_path=?,remote_hash=?,status='downloaded',downloaded_at=datetime('now'),last_seen_at=datetime('now') WHERE id=?").run(dest,sha,remote.id);
  return {remoteDocumentId:remote.id,caseId:remote.case_id,stagingPath:dest,sourcePath:src,sha256:sha};
}
function pause(minutes=30,reason="manual_pause"){
  const until=Date.now()+Math.max(1,Number(minutes)||30)*60*1000;
  db.prepare(`UPDATE uyap_rate_state SET circuit_open_until_ms=?,state=?,updated_at=datetime('now') WHERE id=1`).run(until,reason);
  return rateState();
}
function resume(){
  db.prepare(`UPDATE uyap_rate_state SET circuit_open_until_ms=0,consecutive_failures=0,state='ready',updated_at=datetime('now') WHERE id=1`).run();
  return rateState();
}
function queue(limit=100){
  return db.prepare(`SELECT q.*,e.purpose,e.host,e.path FROM uyap_command_queue q
    LEFT JOIN uyap_endpoints e ON e.endpoint_key=q.endpoint_key ORDER BY q.id DESC LIMIT ?`).all(Number(limit)||100);
}
function enqueueKnownCaseDocuments(){
  const rows=db.prepare("SELECT id FROM cases WHERE external_id LIKE 'uyap:%' AND uyap_dosya_id IS NOT NULL ORDER BY id").all();
  let queued=0,skipped=0;
  for(const r of rows){
    const active=db.prepare("SELECT id FROM uyap_command_queue WHERE endpoint_key='document.list' AND status IN ('queued','running') AND payload_json LIKE ? ORDER BY id LIMIT 1")
      .get('%"caseId":'+Number(r.id)+'%');
    if(active){skipped++;continue}
    try{enqueueCaseDocumentSync(r.id);queued++}catch{skipped++}
  }
  return {total:rows.length,queued,skipped};
}
function archiveStatus(){
  const c=db.prepare("SELECT count(*) n FROM cases WHERE external_id LIKE 'uyap:%'").get().n;
  const d=db.prepare("SELECT count(*) n FROM uyap_remote_documents").get().n;
  const i=db.prepare("SELECT count(*) n FROM uyap_remote_documents WHERE local_asset_id IS NOT NULL").get().n;
  const q=db.prepare("SELECT count(*) n FROM uyap_remote_documents WHERE status='download_queued'").get().n;
  const dl=db.prepare("SELECT count(*) n FROM uyap_remote_documents WHERE status='downloaded'").get().n;
  const w=db.prepare("SELECT count(*) n FROM uyap_remote_documents WHERE status='discovered' AND local_asset_id IS NULL").get().n;
  const s=db.prepare("SELECT count(*) n FROM uyap_remote_documents WHERE status='skipped'").get().n;
  const rv=db.prepare("SELECT count(*) n FROM uyap_remote_documents WHERE status='review'").get().n;
  const f=db.prepare("SELECT count(*) n FROM uyap_command_queue WHERE status='failed'").get().n;
  const cbsUnits=db.prepare("SELECT status,count(*) n FROM uyap_command_queue WHERE endpoint_key='cbs.units' GROUP BY status").all();
  const cbsSearch=db.prepare("SELECT status,count(*) n FROM uyap_command_queue WHERE endpoint_key='cbs.search' GROUP BY status").all();
  const discovery=db.prepare("SELECT status,count(*) n FROM uyap_command_queue WHERE payload_json LIKE '%\"discovery\":true%' GROUP BY status").all();
  const fold=rows=>Object.fromEntries(rows.map(r=>[r.status,Number(r.n||0)]));
  return {
    cases:Number(c||0),remoteDocuments:Number(d||0),indexed:Number(i||0),downloadQueued:Number(q||0),
    downloaded:Number(dl||0),waiting:Number(w||0),skipped:Number(s||0),review:Number(rv||0),failedCommands:Number(f||0),
    cbs:{units:fold(cbsUnits),search:fold(cbsSearch)},
    discovery:fold(discovery),
    rate:rateState()
  };
}
function discoveryStatus(){
  const rows=db.prepare(`SELECT status,count(*) n FROM uyap_command_queue WHERE payload_json LIKE '%"discovery":true%' GROUP BY status`).all();
  const counts={queued:0,running:0,completed:0,failed:0};
  for(const r of rows) counts[r.status]=Number(r.n||0);
  const totalCases=db.prepare("SELECT count(*) n FROM cases WHERE external_id LIKE 'uyap:case:%'").get().n;
  const withDocs=db.prepare("SELECT count(DISTINCT case_id) n FROM uyap_remote_documents").get().n;
  return {...counts,totalCases:Number(totalCases||0),casesWithDocuments:Number(withDocs||0),rate:rateState()};
}
module.exports={GLOBAL_MIN_INTERVAL_MS,observe,observations,endpoints,approveEndpoint,setEndpointEnabled,enqueue,claimNext,reportResult,pause,resume,rateState,sessionState,setSessionLoginRequired,setDocumentDownloadState,setManualDownloadPause,recoverSession,queue,cases,remoteDocuments,documentDownloadPolicy,caseDownloadSummary,activeCaseDownloadCount,enqueueCaseDocumentSync,enqueueRemoteDocumentDownload,enqueuePendingDownloads,enqueueKnownCaseDocuments,archiveStatus,ingestDownloadedDocument,upsertRemoteList,upsertHearings,upsertCasesFromSearch,enqueueHearingRange,enqueueCaseDiscovery,enqueueCaseSearchPage,enqueueCbsDiscovery,enqueueCbsUnits,enqueueCbsSearchPage,discoveryStatus};
