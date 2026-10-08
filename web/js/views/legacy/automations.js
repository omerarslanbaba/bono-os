import {api} from '../api.js';
import {mount,pageHero,section,empty,esc,badge} from '../ui.js';

function fmt(v){return v?String(v).replace('T',' ').slice(0,16):'—'}
function scheduleText(w){
 const m=Number(w.trigger_config?.minutes||0);
 if(w.trigger_type==='event') return 'Olay tetiklemeli';
 if(!m) return 'Zamanlanmış';
 if(m%1440===0)return (m/1440)+' günde bir';
 if(m%60===0)return (m/60)+' saatte bir';
 return m+' dakikada bir';
}
function statusBadge(s){
 const c=s==='completed'?'green':s==='failed'||s==='cancelled'?'red':s==='running'||s==='queued'?'blue':'';
 return badge(s||'—',c);
}

export async function renderAutomations(){
 const [defs,runs,approvals,bus,provider,backup]=await Promise.all([
   api.workflows(),api.workflowRuns(40),api.workflowApprovals(),api.eventBusStatus(),api.providerStatus(),api.backupHealth()
 ]);
 const cards=defs.map(w=>`<div class="automation-card">
   <div class="automation-card-top">
     <div><strong>${esc(w.name)}</strong><span>${esc(w.description||'')}</span></div>
     ${w.enabled?badge('Aktif','green'):badge('Kapalı','red')}
   </div>
   <div class="automation-meta">
     <span><b>Tetikleyici</b>${esc(scheduleText(w))}</span>
     <span><b>Adım</b>${w.step_count}</span>
     <span><b>Son çalışma</b>${esc(fmt(w.last_run_at))}</span>
     <span><b>Aktif run</b>${w.active_runs}</span>
   </div>
   <div class="automation-actions">
     ${w.trigger_type==='schedule'?'<button class="run-workflow primary-action" data-key="'+esc(w.key)+'">Şimdi Çalıştır</button>':'<span class="automation-note">UYAP/Event Bus tarafından otomatik tetiklenir</span>'}
   </div>
 </div>`).join('');

 const approvalBody=approvals.length?approvals.map(a=>`<div class="approval-row">
   <div><strong>${esc(a.workflow_name)}</strong><span>${esc(a.step_key)} · ${esc(a.reason||'İnsan onayı gerekli')}</span></div>
   <div class="row-actions"><button class="reject-approval subtle-action" data-id="${a.id}">Reddet</button><button class="approve-workflow primary-action" data-id="${a.id}">Onayla</button></div>
 </div>`).join(''):empty('Bekleyen otomasyon onayı yok.');

 const runBody=runs.length?runs.map(r=>`<div class="workflow-run-row">
   <div><strong>${esc(r.workflow_name)}</strong><span>${esc(r.trigger_type||'')} · ${esc(fmt(r.created_at))}${r.error?' · '+esc(String(r.error).slice(0,140)):''}</span></div>
   ${statusBadge(r.status)}
 </div>`).join(''):empty('Workflow geçmişi yok.');

 const backupBody=`<div class="backup-status"><div><strong>${backup.count}</strong><span>DB yedeği</span></div><div><strong>${esc(backup.latest?.name||'—')}</strong><span>Son yedek · ${esc(fmt(backup.latest?.modified_at))}</span></div></div><div class="checkpoint-list">${(backup.checkpoints||[]).length?(backup.checkpoints||[]).map(c=>`<div class="workflow-run-row"><div><strong>${esc(c.label)}</strong><span>${esc(fmt(c.created_at))} · DB + kaynak checkpoint</span></div><div class="row-actions">${badge(c.status,'green')}<button class="restore-checkpoint subtle-action" data-id="${c.id}">Geri Yükle</button></div></div>`).join(''):empty('Henüz manuel geri dönüş noktası yok.')}</div>`;

 const engine=`<div class="automation-health-grid">
   <div><strong>${bus.watchers?.enabled||0}</strong><span>Aktif UYAP watcher</span></div>
   <div><strong>${bus.due||0}</strong><span>Kontrol sırası gelen</span></div>
   <div><strong>${bus.events?.pending||0}</strong><span>Bekleyen event</span></div>
   <div><strong>${bus.events?.failed||0}</strong><span>Hatalı event</span></div>
 </div>
 <div class="engine-note"><strong>UYAP</strong><span>Delta watcher aktif; gerçek otomatik indirme kanalı güvenli endpoint doğrulaması tamamlanınca açılacak.</span></div>
 <div class="engine-note"><strong>PTT</strong><span>${esc(provider.ptt?.note||'Operasyonel sağlayıcı')}</span></div>`;

 mount(pageHero('Otomasyonlar','BONO arka planda neyi, ne zaman ve hangi onay sınırıyla çalıştırıyor?')+
   section('Motor Sağlığı','◆',engine)+
   section('Aktif İş Akışları','↻',`<div class="automation-grid">${cards}</div>`)+
   section('Yedek ve Geri Dönüş','⛨',backupBody,'<button id="createCheckpoint" class="subtle-action">Geri Dönüş Noktası Oluştur</button>')+
   section('İnsan Onayı Bekleyenler','✓',approvalBody)+
   section('Son Çalışmalar','◌',runBody),'automations');

 document.querySelector('#createCheckpoint')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;e.currentTarget.textContent='Oluşturuluyor…';await api.createCheckpoint('BONO Desktop manuel geri dönüş noktası');renderAutomations()});
 document.querySelectorAll('.restore-checkpoint').forEach(btn=>btn.onclick=async()=>{const confirmText=prompt('Geri yükleme bir sonraki BONO başlangıcında uygulanacak. Devam etmek için GERI_YUKLE yazın.');if(confirmText!=='GERI_YUKLE')return;btn.disabled=true;await api.requestRestore(btn.dataset.id,confirmText);alert('Geri yükleme sıraya alındı. BONO tamamen kapatılıp yeniden açıldığında uygulanacak.');renderAutomations()});
 document.querySelectorAll('.run-workflow').forEach(btn=>btn.onclick=async()=>{
   btn.disabled=true;const old=btn.textContent;btn.textContent='Çalıştırılıyor…';
   try{await api.triggerWorkflow(btn.dataset.key,{});setTimeout(()=>renderAutomations(),700)}
   catch(e){btn.disabled=false;btn.textContent=old;alert(e.message)}
 });
 document.querySelectorAll('.approve-workflow').forEach(btn=>btn.onclick=async()=>{btn.disabled=true;await api.decideWorkflowApproval(btn.dataset.id,true,'BONO Desktop üzerinden avukat onayı');renderAutomations()});
 document.querySelectorAll('.reject-approval').forEach(btn=>btn.onclick=async()=>{btn.disabled=true;await api.decideWorkflowApproval(btn.dataset.id,false,'BONO Desktop üzerinden reddedildi');renderAutomations()});
}
