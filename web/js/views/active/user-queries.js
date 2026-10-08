import {esc} from '../../ui.js';
const labels={archived_never_executed:'Arşivlendi · hiç yürütülmedi',never_executed:'Hiç yürütülmedi',legacy_attempted_unverified:'Eski yürütme kaydı · sonuç doğrulanmadı',queued:'Kullanıcı sorgusu sırada',running:'Sorgu yürütülüyor',completed:'Doğrulanmış sonuç',failed:'Başarısız',execution_unknown:'Yürütme sonucu belirsiz · otomatik tekrar yok'};
async function read(url,options){const r=await fetch(url,options);const v=await r.json();if(!r.ok)throw Error(v.error||'Sorgu servisi kullanılamıyor');return v;}
export async function mountGlobalQueryHistory(){
 const panel=document.createElement('section');panel.innerHTML='<h2>Kalıcı sorgu geçmişi</h2><div></div><button type="button">Önceki kayıtlar</button>';document.getElementById('app')?.append(panel);
 let before='';const button=panel.querySelector('button'),body=panel.querySelector('div');
 async function load(){button.disabled=true;try{const rows=await read('/api/uyap/query-history?limit=100'+(before?'&before='+before:''));if(!panel.isConnected)return;
  for(const r of rows){const line=document.createElement('p');line.textContent=(r.case_id?'Dosya #'+r.case_id:'Hedef dosya bilinmiyor')+' · '+r.operation+' · '+(labels[r.state]||'Doğrulama gerekiyor')+' · '+(r.created_at||'Tarih bilinmiyor');body.append(line);}before=rows.at(-1)?.command_id||before;button.disabled=rows.length<100;
 }catch(e){body.textContent=e.message;}}
 button.onclick=load;await load();
}
export async function mountUserQueries(caseId,onComplete){
 const button=document.getElementById('syncUyapDocs'),notice=document.getElementById('syncUyapStatus');if(!button||!notice)return;
 button.disabled=true;document.getElementById('queueCaseDownloads')?.setAttribute('disabled','');
 const dn=document.getElementById('caseDownloadStatus');if(dn)dn.textContent='İndirme ayrı belge seçimi ve açık onay gerektirir.';
 const base='/api/uyap/cases/'+caseId;
 const refresh=document.createElement('button');refresh.type='button';refresh.className='subtle-action';refresh.textContent='UYAP’tan yeniden sorgula';refresh.disabled=true;button.after(refresh);
 const history=document.createElement('div');history.className='query-history';history.setAttribute('aria-live','polite');button.closest('.case-sync-panel').after(history);
 let busy=false,pending=null,disposed=false;
 const alive=()=>!disposed&&notice.isConnected;
 async function renderHistory(){const rows=await read(base+'/query-history');if(!alive())return;history.innerHTML='<h3>Sorgu geçmişi</h3>'+(rows.length?'<table><thead><tr><th>İşlem</th><th>Oluşturulma</th><th>Durum</th><th>Son durum zamanı</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.operation)+'</td><td>'+esc(r.created_at||'Bilinmiyor')+'</td><td>'+esc(labels[r.state]||'Doğrulama gerekiyor')+'</td><td>'+esc(r.occurred_at||'')+'</td></tr>').join('')+'</tbody></table>':'<p>Henüz sorgu kaydı yok. Dosyayı açmak UYAP sorgusu başlatmaz.</p>');return rows;}
 async function start(force){if(busy||!alive())return;busy=true;button.disabled=refresh.disabled=true;
  if(!pending||pending.refresh!==force)pending={requestKey:crypto.randomUUID(),refresh:force};
  try{const out=await read(base+'/query',{method:'POST',headers:{'Content-Type':'application/json','X-Bono-User-Action':'1'},body:JSON.stringify(pending)});pending=null;
   notice.textContent=out.state==='cache_hit'?'Geçerli önbellek sonucu gösteriliyor; UYAP isteği gönderilmedi.':'Yalnız bu dosya için kullanıcı sorgusu kabul edildi.';
   if(out.state==='cache_hit'){await renderHistory();return;}
   for(let i=0;i<300&&alive();i++){const rows=await renderHistory();const r=rows?.find(x=>x.command_id===out.commandId);if(r&&!['queued','running'].includes(r.state)){notice.textContent=labels[r.state]||'Doğrulama gerekiyor';if(r.state==='completed'&&alive()){disposed=true;await onComplete();}return;}await new Promise(r=>setTimeout(r,2000));}
  }catch(e){if(alive())notice.textContent=e.message+' · tekrar denemede aynı işlem anahtarı korunur.';}finally{busy=false;if(alive())button.disabled=refresh.disabled=false;}
 }
 try{const support=await read(base+'/query-support');if(!alive())return;await renderHistory();
  if(!support.supported){notice.textContent='Desteklenmiyor veya dosya bağı doğrulaması gerekiyor: '+support.reason;button.textContent='Doğrulama gerekiyor';return;}
  notice.textContent='Sorgula geçerli önbelleği kullanır. Yeniden sorgula yalnız bu dosya için yeni istek oluşturur. İndirme askısı değişmez.';button.textContent='Sorgula / önbelleği göster';button.disabled=refresh.disabled=false;button.onclick=()=>start(false);refresh.onclick=()=>start(true);
  const options=await read(base+'/download-options');if(!alive()||!options.length)return;
  const picker=document.createElement('div');picker.innerHTML='<h3>Aidiyeti doğrulanmış belgeler</h3>'+options.map(d=>'<label><input type="checkbox" value="'+Number(d.id)+'"> Belge #'+Number(d.id)+'</label> ').join('')+'<button type="button">Seçilen belgeleri indirme kuyruğuna al</button><button type="button">İndirme askısını ayrıca kaldır</button><p role="status"></p>';history.after(picker);
  const [approve,resume]=picker.querySelectorAll('button'),message=picker.querySelector('p');let downloadAction=null;
  approve.onclick=async()=>{const documentIds=[...picker.querySelectorAll('input:checked')].map(x=>Number(x.value));if(!documentIds.length||!confirm('Yalnız seçilen '+documentIds.length+' belgenin fiziksel indirmesine onay veriyor musunuz? İndirme askısı değişmeyecek.'))return;
   if(!downloadAction||JSON.stringify(downloadAction.documentIds)!==JSON.stringify(documentIds))downloadAction={requestKey:crypto.randomUUID(),documentIds,confirmed:true};approve.disabled=true;
   try{await read(base+'/approved-downloads',{method:'POST',headers:{'Content-Type':'application/json','X-Bono-User-Action':'1'},body:JSON.stringify(downloadAction)});message.textContent='Seçim onaylandı. Askı açıksa indirme başlamaz.';downloadAction=null;}catch(e){message.textContent=e.message;}finally{approve.disabled=false;}
  };
  resume.onclick=async()=>{if(!confirm('Daha önce açıkça onaylanan indirmeler çalışabilir. İndirme askısını kaldırmayı ayrıca onaylıyor musunuz?'))return;resume.disabled=true;
   try{await read('/api/uyap/download-pause',{method:'POST',headers:{'Content-Type':'application/json','X-Bono-User-Action':'1'},body:JSON.stringify({confirmed:true,paused:false})});message.textContent='İndirme askısı ayrı onayla kaldırıldı.';}catch(e){message.textContent=e.message;}finally{resume.disabled=false;}
  };
 }catch(e){if(alive())notice.textContent=e.message;}
}
