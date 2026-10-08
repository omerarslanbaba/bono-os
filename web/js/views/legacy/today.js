import {api} from '../api.js';
import {mount,kpi,section,empty,pageHero,esc,badge} from '../ui.js';

const severityLabel={critical:'Kritik',action:'İşlem',warning:'Uyarı',info:'Bilgi'};
const severityClass={critical:'red',action:'blue',warning:'',info:''};

function briefRow(x){
 const mark=x.kind==='hearing'?'⚖':x.kind==='deadline'?'◷':x.kind==='task'?'✓':'▤';
 return `<div class="brief-row"><div class="brief-mark">${mark}</div><div class="brief-when">${esc(x.when||'')}</div><div><div class="doc-title">${esc(x.title||'')}</div><div class="doc-meta">${esc(x.subtitle||'')}</div></div></div>`;
}
function radarRow(x){
 const file=x.file_no||x.court_file_no||'';
 const href=x.office_file_id?'#cases/'+x.office_file_id:'#today';
 return `<div class="radar-row severity-${esc(x.severity)}">
   <div class="radar-severity">${esc(severityLabel[x.severity]||x.severity)}</div>
   <div class="radar-copy">
     <a href="${href}" class="radar-title">${esc(x.title)}</a>
     <div class="doc-meta">${file?esc(file)+' · ':''}${esc(x.detail||'')}</div>
   </div>
   <div class="row-actions">
     ${x.office_file_id?'<a class="subtle-action mini-link" href="#cases/'+x.office_file_id+'">Föy</a>':''}
     <button class="resolve-radar subtle-action" data-id="${x.id}">Tamamlandı</button>
   </div>
 </div>`;
}
function workflowState(w){
 if(w.active_runs) return badge(w.active_runs+' aktif','blue');
 return badge('Hazır','green');
}

export async function renderToday(){
 const [s,b,jobs,radar,shipments,workflows,approvals,bus]=await Promise.all([
   api.summary(),api.brief(),api.jobs(),api.workRadar({status:'open'}),api.shipments(),api.workflows(),api.workflowApprovals(),api.eventBusStatus()
 ]);
 const critical=radar.filter(x=>x.severity==='critical').length;
 const action=radar.filter(x=>x.severity==='action').length;
 const openPostal=shipments.filter(x=>!['receipt_received','closed'].includes(x.status)).length;
 const newItems=Number(b.newAssets||0)+Number(b.newNotifications||0);
 const hero=pageHero(
   'Bugün',
   critical||action
     ? `Öncelikli ${critical+action} iş var. Hukuki sonuç doğuran tarihler ayrıca avukat onayı bekler.`
     : 'BONO Sabah Özeti · Önce müdahale gerektiren işleri gör.'
 );
 const cards=`<div class="kpis">
   ${kpi('⚖','Bugünkü duruşmalar',b.todayHearings||0)}
   ${kpi('◷','7 günlük süreler',b.urgentDeadlines||0)}
   ${kpi('◎','Açık iş radarı',radar.length)}
   ${kpi('✉','Aktif tebligat',openPostal)}
 </div>`;

 const briefBody=(b.items||[]).length?(b.items||[]).map(briefRow).join(''):empty('Bugün için takvim/süre kaydı bulunmuyor.');
 const radarBody=radar.length?radar.slice(0,14).map(radarRow).join(''):empty('Açık fiziksel/operasyonel iş bulunmuyor.');
 const automationBody=workflows.map(w=>`<div class="automation-mini">
   <div><strong>${esc(w.name)}</strong><span>${esc(w.last_run_at||'Henüz çalışmadı')}</span></div>
   ${workflowState(w)}
 </div>`).join('');
 const systemBody=`<div class="stat-grid">
   <div><strong>${s.clients}</strong><span>Müvekkil</span></div>
   <div><strong>${s.localAssets}</strong><span>Yerel Belge</span></div>
   <div><strong>${bus.events?.pending||0}</strong><span>Event Kuyruğu</span></div>
   <div><strong>${approvals.length}</strong><span>İnsan Onayı</span></div>
 </div>`;
 const noticeBody=`<div class="notice-row"><div><div class="doc-title">Yeni/işlenmemiş kayıt</div><div class="doc-meta">Bugün indekslenen evrak + yeni tebligat</div></div><span class="count">${newItems}</span></div>
 <div class="notice-row"><div><div class="doc-title">Kritik iş radarı</div><div class="doc-meta">Süre/mazbata gibi avukat kontrolü gerektiren işler</div></div><span class="count">${critical}</span></div>
 <div class="notice-row"><div><div class="doc-title">Hatalı arka plan işi</div><div class="doc-meta">Yeniden deneme limiti sonrası</div></div><span class="count">${s.failedJobs}</span></div>`;

 mount(hero+cards+`<div class="dashboard-grid">
   <div class="section-stack">
     ${section('Fiziksel İş Radarı','◎',radarBody,'<a class="subtle-action mini-link" href="#automations">Otomasyonlar</a>')}
     ${section('Takvim ve Süre Özeti','◷',briefBody)}
   </div>
   <div class="section-stack">
     ${section('Otomasyon Sağlığı','↻',automationBody)}
     ${section('BONO Çekirdeği','◆',systemBody)}
     ${section('Kontrol','!',noticeBody)}
   </div>
 </div>`,'today');

 document.querySelectorAll('.resolve-radar').forEach(btn=>btn.addEventListener('click',async()=>{
   btn.disabled=true;btn.textContent='Kapatılıyor…';
   try{await api.resolveWorkRadar(btn.dataset.id);await renderToday()}catch(e){btn.disabled=false;btn.textContent='Tamamlandı';alert(e.message)}
 }));
}
