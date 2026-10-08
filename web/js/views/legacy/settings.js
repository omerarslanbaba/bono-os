import {api} from '../api.js';
import {mount,pageHero,section,empty,esc,badge} from '../ui.js';

export async function renderSettings(){
 const [jobs,roots,audit,uyap,obs,intel,health]=await Promise.all([
   api.jobs(),api.roots(),api.audit(),api.uyapStatus(),api.uyapObservations(),api.intelligenceStatus(),api.serviceHealth()
 ]);
 const rootsBody=roots.length?roots.map(r=>`<div class="notice-row"><div><div class="doc-title">${esc(r.label||'Klasör')}</div><div class="doc-meta">${esc(r.path)} · son tarama ${esc(r.last_scanned_at||'—')}</div></div>${badge(r.enabled?'Aktif':'Kapalı',r.enabled?'green':'')}</div>`).join(''):empty('Tarama klasörü yok.');
 const jobsBody=jobs.length?jobs.slice(0,12).map(j=>`<div class="notice-row"><div><div class="doc-title">#${j.id} · ${esc(j.job_type)}</div><div class="doc-meta">${esc(j.created_at||'')} · ${j.attempts}/${j.max_attempts}</div></div>${badge(j.status,j.status==='completed'?'green':j.status==='failed'?'red':'blue')}</div>`).join(''):empty('Job yok.');
 const auditBody=audit.length?audit.slice(0,12).map(a=>`<div class="notice-row"><div><div class="doc-title">${esc(a.action)}</div><div class="doc-meta">${esc(a.occurred_at)} · ${esc(a.actor)} · ${esc(a.entity_type||'')}</div></div></div>`).join(''):empty('Audit kaydı yok.');
 const uyapMode=uyap.rate?.integration_mode==='observe_only'?'Gözlem Modu':uyap.rate?.integration_mode||'Bilinmiyor';
 const uyapHead=`<div class="stat-grid"><div><strong>${esc(uyapMode)}</strong><span>Entegrasyon modu</span></div><div><strong>${uyap.globalMinIntervalMs} ms</strong><span>Minimum UYAP aralığı</span></div><div><strong>${uyap.observationCount}</strong><span>Gözlenen endpoint</span></div><div><strong>${uyap.endpointCount}</strong><span>Onaylı endpoint</span></div></div>`;
 const obsBody=obs.length?obs.slice(0,10).map(o=>`<div class="notice-row"><div><div class="doc-title">${esc(o.method)} · ${esc(o.path)}</div><div class="doc-meta">${esc(o.host)} · HTTP ${esc(o.status||'—')} · ${o.hit_count} gözlem</div></div>${badge(o.content_type?.includes('json')?'JSON':'Ağ')}</div>`).join(''):empty('Henüz UYAP ağ gözlemi yok. Normal portal kullanımıyla endpoint haritası oluşacak.');
 const healthBody=health.length?health.map(h=>`<div class="notice-row"><div><div class="doc-title">${esc(h.service)}</div><div class="doc-meta">son heartbeat ${esc(h.last_heartbeat_at||'—')}</div></div>${badge(h.state,h.state==='ok'?'green':'red')}</div>`).join(''):empty('Servis heartbeat henüz oluşmadı.');
 const intelBody=`<div class="stat-grid"><div><strong>${intel.udfAssets}</strong><span>UDF varlığı</span></div><div><strong>${intel.analyzed}</strong><span>Analiz tamam</span></div><div><strong>${intel.chunks}</strong><span>Bilgi parçası</span></div><div><strong>${intel.officeStyleCandidates}</strong><span>BONO stil adayı</span></div></div>`;
 const buttons='<div class="action-bar"><button data-job="scan_documents">Belge Taraması</button><button data-job="analyze_udf_library">UDF Hafızasını Yenile</button><button data-job="rebuild_search">Arama İndeksi</button><button data-job="import_vekalet">Vekâletleri Yenile</button><button data-job="backup_db">Şimdi Yedekle</button></div>';
 mount(pageHero('Ayarlar ve Sistem','Arka plan işleri, UDF hafızası, watchdog/heartbeat, yedekleme ve UYAP gözlem katmanı.')+buttons+
   `<div class="grid"><div class="section-stack">${section('Servis Sağlığı','●',healthBody)}${section('UDF / Belge Zekâsı','✦',intelBody)}${section('UYAP Köprüsü','⚖',uyapHead+obsBody)}</div><div class="section-stack">${section('Arka Plan Kuyruğu','◌',jobsBody)}${section('Tarama Kökleri','▤',rootsBody)}${section('Audit Log','◷',auditBody)}</div></div>`,'settings');
 document.querySelectorAll('[data-job]').forEach(b=>b.onclick=async()=>{
   b.disabled=true;const old=b.textContent;b.textContent='Kuyruğa alınıyor…';
   try{await api.enqueue(b.dataset.job,{},'manual-'+b.dataset.job+':'+new Date().toISOString(),50);b.textContent='Kuyruğa alındı';setTimeout(()=>renderSettings(),1500)}
   catch(e){b.textContent=e.message;setTimeout(()=>{b.textContent=old;b.disabled=false},1800)}
 });
}