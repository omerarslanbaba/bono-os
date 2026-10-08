import {api} from '../../api.js';
import {inventoryTotals,notificationContract} from '../../inventory-state.mjs';
import {mount,pageHero,section,empty,esc,kpi} from '../../ui.js';

export async function renderToday(){
  const [brief,hearings,inventoryRows]=await Promise.all([api.morningBrief(),api.upcomingHearings(250),api.uyapCases().catch(()=>null)]);
  const items=(brief?.items||[]);
  const now=Date.now(),weekEnd=now+7*24*60*60*1000;
  const next7=hearings.filter(h=>{const t=new Date(h.starts_at||0).getTime();return t>=now&&t<=weekEnd;});
  const briefBody=items.length?items.slice(0,12).map(x=>`<div class="brief-row"><div class="brief-when">${esc(x.when||'')}</div><div><div class="doc-title">${esc(x.title||'')}</div><div class="doc-meta">${esc(x.subtitle||'')}</div></div></div>`).join(''):empty('Bugün için kayıt yok.');
  const hearingBody=hearings.length?hearings.slice(0,8).map(h=>`<a class="notice-row clickable" href="#hearings/${h.id}"><div><div class="doc-title">${esc(h.court||'Duruşma')}</div><div class="doc-meta">${esc((h.starts_at||'').replace('T',' ').slice(0,16))} · ${esc(h.court_file_no||'')}</div></div><span>→</span></a>`).join(''):empty('Yaklaşan duruşma yok.');
  const inv=inventoryRows?inventoryTotals(inventoryRows):null;
  const inventoryBody=inv?`<div class="case-document-summary"><div><strong>${inv.known}</strong><span>Bilinen dosya</span></div><div><strong>${inv.never}</strong><span>Hiç sorgulanmadı</span></div><div><strong>${inv.partial}</strong><span>Kısmi liste</span></div><div><strong>${inv.unknown}</strong><span>Kapsam belirsiz</span></div></div><p>Belirsiz kapsam sıfır evrak anlamına gelmez.</p><a href="#uyap">Dosya envanterini aç →</a>`:empty('Envanter verisi alınamadı.');
  mount(pageHero('Bugün','Günün duruşma, süre ve işlem görünümü.')+
    section('Dosya Envanteri','▤',inventoryBody)+section('Bildirim Merkezi','',esc(notificationContract.message))+
    `<div class="kpis dashboard-kpis">${kpi('◷','Bugünkü duruşma',brief?.todayHearings||0)}${kpi('⚖','7 gün içindeki duruşma',next7.length)}${kpi('!','7 gün içindeki süre',brief?.urgentDeadlines||0)}${kpi('✓','Bugünkü açık iş',brief?.todayTasks||0)}</div>`+
    `<div class="dashboard-grid"><div class="section-stack">${section('Günlük Özet','◷',briefBody)}</div><div class="section-stack">${section('Yaklaşan Duruşmalar','⚖',hearingBody)}</div></div>`,'today');
}
