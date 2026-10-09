import {esc} from '../../ui.js';
import {queryOverview,queryLabels,queryWaitReason,queryTime} from '../../case-query-state.mjs';
const labels={archived_never_executed:'Arşivlendi · hiç yürütülmedi',never_executed:'Hiç yürütülmedi',legacy_attempted_unverified:'Eski yürütme kaydı · sonuç doğrulanmadı',queued:'Kullanıcı sorgusu sırada',running:'Sorgu yürütülüyor',completed:'Doğrulanmış sonuç',not_found:'Hedef dosya bulunamadı',ambiguous:'Birden fazla eşleşme bulundu',identity_mismatch:'UYAP kimliği mevcut kayıtla uyuşmuyor',failed:'Başarısız',execution_unknown:'Yürütme sonucu belirsiz · otomatik tekrar yok'};
const persistedResultStates=new Set(['completed','not_found','failed','user_action_expired']);
const resultLabels={completed:'Tamamlandı',not_found:'Dosya bulunamadı',failed:'Başarısız',cache_hit:'Önbellekten gösterildi',user_action_expired:'İşlem izni doldu'};
const resultKey=caseId=>'bono:uyap:last-query-result:'+caseId;
function rememberedResult(caseId){
 try{const v=JSON.parse(sessionStorage.getItem(resultKey(caseId))||'null');return v?.state==='cache_hit'&&Number.isSafeInteger(Number(v.commandId))?v:null;}catch{return null;}
}
function rememberCacheHit(caseId,commandId,operation){
 try{sessionStorage.setItem(resultKey(caseId),JSON.stringify({state:'cache_hit',commandId:Number(commandId),operation:operation||null}));}catch{}
}
function forgetRememberedResult(caseId){try{sessionStorage.removeItem(resultKey(caseId));}catch{}}
function resultExplanation(state,operation){
 if(state==='completed'&&operation==='cbs.search')return 'Dosya sorgusu tamamlandı. Evrak listesi henüz aktarılmadı.';
 if(state==='completed'&&operation==='document.list')return 'Evrak listesi sorgusu tamamlandı.';
 if(state==='completed')return 'Sorgu tamamlandı.';
 if(state==='not_found')return 'Dosya sorgusu tamamlandı ancak hedef dosya bulunamadı.';
 if(state==='failed')return 'Sorgu başarısız oldu. Hata kodu teknik ayrıntılarda gösteriliyor.';
 if(state==='cache_hit')return operation==='cbs.search'?'Geçerli önbellekteki dosya sorgusu sonucu gösteriliyor. Yeni UYAP sorgusu yapılmadı. Evrak listesi henüz aktarılmadı.':'Geçerli önbellek sonucu gösteriliyor. Yeni UYAP sorgusu yapılmadı.';
 if(state==='user_action_expired')return 'Sorgu izni süresi doldu. Yeniden sorgulama gerekir.';
 return queryLabels[state]||'Sorgu sonucu belirsiz.';
}
function resultOutcome(row,state=row?.state){
 if(!row)return null;
 return {row,state,commandId:Number(row.command_id),operation:row.operation,label:resultLabels[state]||queryLabels[state]||'Sonuç belirsiz',explanation:resultExplanation(state,row.operation)};
}
function persistentOutcome(caseId,rows,latest){
 const remembered=rememberedResult(caseId);
 if(remembered){
  if(latest&&['queued','running'].includes(latest.state)&&Number(latest.command_id)!==Number(remembered.commandId))forgetRememberedResult(caseId);
  else{
   const row=rows.find(r=>Number(r.command_id)===Number(remembered.commandId));
   if(row?.state==='completed')return resultOutcome(row,'cache_hit');
   forgetRememberedResult(caseId);
  }
 }
 return latest&&persistedResultStates.has(latest.state)?resultOutcome(latest):null;
}
function historyResultLabel(row,outcome){
 if(outcome?.state==='cache_hit'&&Number(outcome.commandId)===Number(row.command_id))return 'Tamamlandı · son işlem önbellekten gösterildi';
 return queryLabels[row.state]||'Sonuç belirsiz';
}
function technicalResultText(row,state,reason,readError){
 if(!row)return 'Komut kaydı yok'+(readError?' · Bağlantı durumu okunamadı: '+readError:'');
 const parts=[
  'Komut #'+row.command_id,
  row.operation,
  'Sonuç: '+(resultLabels[state]||queryLabels[state]||'Sonuç belirsiz'),
  'Sonuç kaydı: '+(row.result_ref||'yok'),
  'Hata kodu: '+(row.error_code||'yok'),
  'Açıklama: '+resultExplanation(state,row.operation)
 ];
 if(reason)parts.push(reason);
 if(readError)parts.push('Bağlantı durumu okunamadı: '+readError);
 return parts.join(' · ');
}
async function read(url,options){const r=await fetch(url,options);const v=await r.json();if(!r.ok)throw Error(v.error||'Sorgu servisi kullanılamıyor');return v;}
export async function mountGlobalQueryHistory(){
 const panel=document.createElement('section');panel.innerHTML='<h2>Kalıcı sorgu geçmişi</h2><div></div><button type="button">Önceki kayıtlar</button>';document.getElementById('app')?.append(panel);
 let before='';const button=panel.querySelector('button'),body=panel.querySelector('div');
 async function load(){button.disabled=true;try{const rows=await read('/api/uyap/query-history?limit=100'+(before?'&before='+before:''));if(!panel.isConnected)return;
  for(const r of rows){const line=document.createElement('p');line.textContent=(r.case_id?'Dosya #'+r.case_id:'Hedef dosya bilinmiyor')+' · '+r.operation+' · '+(labels[r.state]||'Doğrulama gerekiyor')+' · '+(r.created_at||'Tarih bilinmiyor');body.append(line);}before=rows.at(-1)?.command_id||before;button.disabled=rows.length<100;
 }catch(e){body.textContent=e.message;}}
 button.onclick=load;await load();
}
let activeQueryMonitor=null;
export async function mountUserQueries(caseId,onComplete,{documentCount=0}={}){
 activeQueryMonitor?.();
 const button=document.getElementById('syncUyapDocs'),notice=document.getElementById('syncUyapStatus');if(!button||!notice)return;
 button.disabled=true;document.getElementById('queueCaseDownloads')?.setAttribute('disabled','');
 const dn=document.getElementById('caseDownloadStatus');if(dn)dn.textContent='Doğrulanmış indirilebilir belge kontrol ediliyor.';
 const base='/api/uyap/cases/'+caseId;
 const refresh=document.createElement('button');refresh.type='button';refresh.className='subtle-action';refresh.textContent='UYAP’tan yeniden sorgula';refresh.disabled=true;button.after(refresh);
 const checkConnection=document.createElement('button');checkConnection.type='button';checkConnection.className='subtle-action';checkConnection.textContent='Bağlantı ve oturumu doğrula';refresh.after(checkConnection);
 let checkTimer=null,checkKey=null;
 checkConnection.onclick=async()=>{
  checkConnection.disabled=true;notice.textContent='Tek oturum kontrolü isteniyor; dosya sorgusu veya indirme yapılmayacak.';
  checkKey ||= crypto.randomUUID();
  try{
   await read('/api/uyap/session-check/start',{method:'POST',headers:{'Content-Type':'application/json','X-Bono-User-Action':'1'},body:JSON.stringify({requestKey:checkKey})});
   async function watch(){
    if(!alive())return;
    try{const out=await read('/api/uyap/user-query-state'),s=out.sessionCheck;
     if(s?.state==='ready'){notice.textContent='Bridge bağlantısı ve UYAP oturumu doğrulandı. Dosya sorgusu başlatılmadı.';checkKey=null;checkConnection.disabled=false;return;}
     if(['blocked','expired','not_started'].includes(s?.state)){notice.textContent=s.reason==='login_required'?'UYAP oturum kontrolü reddedildi; kullanıcı girişi gerekli.':'Bağlantı/oturum doğrulanamadı; otomatik tekrar veya dosya sorgusu yapılmadı.';checkKey=null;checkConnection.disabled=false;return;}
     notice.textContent=s?.state==='claimed'?'Bridge oturum kontrolünü aldı; yanıt bekleniyor.':'Hazır Chrome Bridge bekleniyor; dosya sorgusu oluşturulmadı.';checkTimer=setTimeout(watch,1500);
    }catch(e){notice.textContent='Kontrol durumu alınamadı: '+e.message;checkConnection.disabled=false;}
   }
   await watch();
  }catch(e){notice.textContent='Oturum kontrolü başlatılamadı: '+e.message;checkConnection.disabled=false;}
 };
 const history=document.getElementById('caseQueryHistory'),technical=document.getElementById('queryTechnicalDetails');
 let busy=false,pending=null,disposed=false,timer=null,supported=false,monitoredId=null,operation=null;
 const alive=()=>!disposed&&notice.isConnected;
 const stop=()=>{disposed=true;clearTimeout(timer);clearTimeout(checkTimer);window.removeEventListener('hashchange',stop)};
 activeQueryMonitor=stop;window.addEventListener('hashchange',stop,{once:true});
 const enable=()=>{button.disabled=refresh.disabled=!supported||busy||monitoredId!==null};
 async function snapshot(){
  const [rows,sessionInfo]=await Promise.all([read(base+'/query-history'),read('/api/uyap/session').catch(e=>({readError:e.message}))]);if(!alive())return;
  const view=queryOverview(rows,documentCount),latest=rows.find(r=>Number(r.command_id)===Number(monitoredId))||view.latest,outcome=persistentOutcome(caseId,rows,latest);
  if(history)history.innerHTML=rows.length?'<table><thead><tr><th>Komut</th><th>İşlem</th><th>Sonuç</th><th>Hata</th><th>Zaman</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>#'+esc(String(r.command_id))+'</td><td>'+esc(r.operation)+'</td><td>'+esc(historyResultLabel(r,outcome))+'</td><td>'+esc(r.error_code||'—')+'</td><td>'+esc(r.occurred_at||r.created_at||'Bilinmiyor')+'</td></tr>').join('')+'</tbody></table>':'Henüz sorgu kaydı yok.';
  const summary=document.getElementById('lastQuerySummary'),documents=document.getElementById('documentListSummary');
  if(summary)summary.textContent='Son UYAP sorgusu: '+view.label+(view.success?' · Son başarılı: '+queryTime(view.success.occurred_at||view.success.created_at):'');
  if(documents)documents.textContent=view.documents;
  const reason=queryWaitReason(latest,sessionInfo),technicalRow=outcome?.row||latest,technicalState=outcome?.state||latest?.state;
  if(technical)technical.textContent=technicalResultText(technicalRow,technicalState,reason,sessionInfo.readError);
  if(dn)dn.textContent=sessionInfo.session?.manualDownloadPaused===true?'İndirmeler askıda. Askı değiştirilmedi.':'İndirme ayrı belge seçimi ve açık onay gerektirir.';
  return {rows,view,latest,reason,outcome};
 }
 async function monitor(){
  if(!alive())return;
  try{const state=await snapshot();if(!state||!alive())return;
   const row=state.rows.find(r=>Number(r.command_id)===Number(monitoredId));
   if(!row){notice.textContent='Sonuç belirsiz: komut henüz geçmiş API’sinde görünmüyor. Yeni sorgu gönderilmedi.';}
   else if(['queued','running'].includes(row.state)){notice.textContent=(queryLabels[row.state]||'Sonuç belirsiz')+(state.reason?' · '+state.reason:'');}
   else {monitoredId=null;forgetRememberedResult(caseId);enable();const outcome=resultOutcome(row);notice.textContent=outcome.explanation;if(row.state==='completed'){await onComplete(outcome.explanation);stop();}return;}
  }catch(e){if(alive())notice.textContent='Sorgu durumu izlenemedi: '+e.message+' · yeni sorgu gönderilmedi.';}
  if(alive())timer=setTimeout(monitor,2500);
 }
 async function start(force){if(busy||monitoredId!==null||!alive())return;busy=true;enable();
  if(!pending||pending.refresh!==force)pending={requestKey:crypto.randomUUID(),refresh:force};
  notice.textContent='İstek Core’a iletiliyor.';
  try{const out=await read(base+'/query',{method:'POST',headers:{'Content-Type':'application/json','X-Bono-User-Action':'1'},body:JSON.stringify(pending)});pending=null;if(!alive())return;
   if(out.state==='cache_hit'){
    if((!Number.isSafeInteger(Number(out.commandId))||Number(out.commandId)<1))throw Error('Komut kimliği alınamadı; sonuç belirsiz');
    rememberCacheHit(caseId,Number(out.commandId),operation);notice.textContent=resultExplanation('cache_hit',operation);await onComplete(notice.textContent);stop();return;
   }
   if(out.state==='cache_miss'){notice.textContent='Geçerli önbellek bulunamadı. Yeni sorgu başlatılmadı.';return;}
   if((!Number.isSafeInteger(Number(out.commandId))||Number(out.commandId)<1))throw Error('Komut kimliği alınamadı; sonuç belirsiz');
   forgetRememberedResult(caseId);monitoredId=Number(out.commandId);notice.textContent=out.state==='existing_pending'?'Mevcut işlem izleniyor; mükerrer sorgu gönderilmedi.':force?'Yenileme isteği kabul edildi; komut durumu izleniyor.':'Geçerli önbellek bulunamadı. Sorgu isteği kabul edildi; komut durumu izleniyor.';
   timer=setTimeout(monitor,300);
  }catch(e){if(alive())notice.textContent='İşlem tamamlanamadı: '+e.message+' · aynı işlemi yeniden denerseniz işlem anahtarı korunur.';}finally{busy=false;if(alive())enable();}
 }
 try{const support=await read(base+'/query-support');if(!alive())return;supported=support.supported===true;operation=support.operation||null;
  const audit=support.identityEvidence;
  if(audit?.transitions?.length){
   const warning=document.createElement('p');warning.className='muted';
   warning.textContent='UYAP dosya kimliği geçmişte değişti. Önceki sorgu kanıtları korundu; kimliklerin kalıcılığı ve eşdeğerliği doğrulanmadı. Evrak bağlantıları yeniden doğrulanmadan indirme açılmaz.';
   notice.after(warning);
  }
  const state=await snapshot();if(!alive())return;
  if(!supported){notice.textContent=state?.outcome?.explanation||('Sorgu engeli / doğrulama gerekiyor: '+(support.reason||'Desteklenen akış yok'));button.textContent='Doğrulama gerekiyor';}
  else {notice.textContent=state?.outcome?.explanation||(support.operation==='cbs.search'?'CBS dosya listesinde bu kayıt aranır. Evrak listesi ve indirme bu işlemden ayrıdır.':'Sorgula geçerli önbelleği kullanır; yoksa Core desteklenen sorguyu sıraya alır. Yeniden sorgula önbelleği yeniler.');button.textContent='Sorgula / önbelleği göster';button.onclick=()=>start(false);refresh.onclick=()=>start(true);}
  const existing=state?.rows.find(r=>!r.legacy&&r.operation===support.operation&&['queued','running'].includes(r.state));
  if(existing){monitoredId=Number(existing.command_id);timer=setTimeout(monitor,0);}
  enable();
  const options=await read(base+'/download-options');if(!alive())return;if(!options.length){if(dn)dn.textContent+=' Aidiyeti doğrulanmış indirilebilir belge yok.';return;}
  const picker=document.createElement('div');picker.innerHTML='<h3>Aidiyeti doğrulanmış belgeler</h3>'+options.map(d=>'<label><input type="checkbox" checked value="'+Number(d.id)+'"> Belge #'+Number(d.id)+'</label> ').join('')+'<p role="status"></p>';document.querySelector('.case-download-controls')?.after(picker);
  const approve=document.getElementById('queueCaseDownloads'),message=picker.querySelector('p');if(!approve)return;approve.disabled=false;approve.textContent='Evrakları İndir ('+options.length+')';let downloadAction=null;
  approve.onclick=async()=>{const documentIds=[...picker.querySelectorAll('input:checked')].map(x=>Number(x.value));if(!documentIds.length||!confirm('Yalnız seçilen '+documentIds.length+' belgenin fiziksel indirmesine onay veriyor musunuz? İndirme askısı değişmeyecek.'))return;
   if(!downloadAction||JSON.stringify(downloadAction.documentIds)!==JSON.stringify(documentIds))downloadAction={requestKey:crypto.randomUUID(),documentIds,confirmed:true};approve.disabled=true;
   try{await read(base+'/approved-downloads',{method:'POST',headers:{'Content-Type':'application/json','X-Bono-User-Action':'1'},body:JSON.stringify(downloadAction)});message.textContent='Seçim onaylandı. Askı açıksa indirme başlamaz.';downloadAction=null;}catch(e){message.textContent=e.message;}finally{approve.disabled=false;}
  };
 }catch(e){if(alive())notice.textContent=e.message;}
}
