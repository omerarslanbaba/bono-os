import {api} from '../../api.js';
import {inventoryTotals,notificationContract} from '../../inventory-state.mjs';
import {nextSevenDays} from '../../calendar-window.mjs';
import {mount,pageHero,section,empty,esc} from '../../ui.js';

export async function renderToday(){
 const [hearings,deadlines,inventoryRows]=await Promise.all([api.upcomingHearings(10000),api.deadlines(10000),api.uyapCases().catch(()=>null)]);
 const now=new Date();
 const next7=nextSevenDays(hearings,'starts_at',now);
 const due7=nextSevenDays(deadlines.filter(d=>d.status==='open'),'due_at',now);
 const hearingBody=next7.length?next7.map(h=>`<a class="notice-row clickable" href="#hearings/${encodeURIComponent(h.id)}"><div><div class="doc-title">${esc(h.court||'Duruşma')}</div><div class="doc-meta">${esc((h.starts_at||'').replace('T',' ').slice(0,16))} · ${esc(h.court_file_no||'')}</div></div><span>→</span></a>`).join(''):empty('Yedi takvim günü içinde duruşma yok.');
 const deadlineBody=due7.length?due7.map(d=>`<div class="notice-row"><div><div class="doc-title">${esc(d.title||'Süre')}</div><div class="doc-meta">${esc(d.due_at||'')} · ${esc(d.court_file_no||'')} · ${d.lawyer_approved?'Onaylı':'Onay bekliyor'}</div></div></div>`).join(''):empty('Yedi takvim günü içinde süre yok.');
 const inv=inventoryRows?inventoryTotals(inventoryRows):null;
 const inventoryBody=inv?`<div class="case-document-summary"><div><strong>${inv.known}</strong><span>Bilinen dosya</span></div><div><strong>${inv.never}</strong><span>Hiç sorgulanmadı</span></div><div><strong>${inv.partial}</strong><span>Kısmi liste</span></div><div><strong>${inv.unknown}</strong><span>Kapsam belirsiz</span></div></div><a href="#uyap">Dosyalarımı aç →</a>`:empty('Envanter verisi alınamadı.');
 mount(pageHero('Bugün','')+section('Dosya Envanteri','▤',inventoryBody)+section('Bildirim Merkezi','',esc(notificationContract.message))+
 `<div class="dashboard-grid"><div>${section('7 Gün İçindeki Duruşmalar','⚖',hearingBody)}</div><div>${section('7 Gün İçindeki Süreler','◷',deadlineBody)}</div></div>`,'today');
}
