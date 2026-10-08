import {api} from '../api.js';
import {mount,pageHero,section,empty,esc,badge} from '../ui.js';

const catLabel={our_side:'Bizim Yapacağımız',opponent:'Karşı Taraf',court_institution:'Mahkeme / Kurum',party_review:'Taraf Kontrolü'};
const catClass={our_side:'green',opponent:'red',court_institution:'blue',party_review:''};
function fmt(v){return v?String(v).replace('T',' ').slice(0,16):'—'}

export async function renderHearings(id){
 if(id)return renderCockpit(id);
 const rows=await api.upcomingHearings(50);
 const body=rows.length?rows.map(h=>`<a class="hearing-list-row" href="#hearings/${h.id}">
   <div class="hearing-date"><strong>${esc(fmt(h.starts_at))}</strong><span>${esc(h.location||'')}</span></div>
   <div><strong>${esc(h.court||'Duruşma')}</strong><span>${esc([h.court_file_no,h.file_no,h.client_name].filter(Boolean).join(' · '))}</span></div>
   <span class="hearing-open">Kokpit →</span>
 </a>`).join(''):empty('Yaklaşan duruşma kaydı yok. UYAP duruşma senkronu geldiğinde bu ekran otomatik dolacak.');
 mount(pageHero('Duruşma Kokpiti','Duruşmadan önce son evrak, ara karar, süre, müzekkere, vekâlet ve açık işleri tek yerde gör.')+
   section('Yaklaşan Duruşmalar','⚖',body),'hearings');
}

async function renderCockpit(id){
 const d=await api.hearingCockpit(id),h=d.hearing;
 const orderGroups=['our_side','opponent','court_institution','party_review'];
 const orderBody=d.actions.length?orderGroups.map(cat=>{
   const items=d.actions.filter(x=>x.category===cat);if(!items.length)return '';
   return `<div class="order-group"><div class="order-group-title">${badge(catLabel[cat]||cat,catClass[cat])}<span>${items.length} kayıt</span></div>
   ${items.map(x=>`<div class="order-row"><div><strong>${esc(x.text)}</strong><span>${esc(x.file_name||'')}${x.duration_text?' · '+esc(x.duration_text):''}${x.candidate_date?' · '+esc(x.candidate_date):''}</span></div><div class="row-actions">${x.deadline_review_required?badge('Süre kontrolü','red'):''}<button class="resolve-order subtle-action" data-id="${x.id}">Tamamlandı</button></div></div>`).join('')}</div>`;
 }).join(''):empty('Ara karar adayı henüz çıkarılmadı.');

 const deadlineBody=d.deadlines.length?d.deadlines.map(x=>`<div class="cockpit-row"><div><strong>${esc(x.title)}</strong><span>${esc(fmt(x.due_at))} · ${esc(x.legal_basis||'')}</span></div>${badge(x.lawyer_approved?'Onaylı':'Taslak',x.lawyer_approved?'green':'red')}</div>`).join(''):empty('Açık süre yok.');
 const corrBody=d.correspondence.length?d.correspondence.map(x=>`<div class="cockpit-row"><div><strong>${esc(x.institution)} · ${esc(x.subject)}</strong><span>${esc(x.status)} · ${esc(fmt(x.sent_at||x.requested_at))}</span></div>${badge(x.status,x.status==='answered'?'green':'')}</div>`).join(''):empty('Müzekkere kaydı yok.');
 const matchBody=d.matches.length?d.matches.map(x=>`<div class="match-row"><div><strong>%${Math.round(x.score*100)} · ${esc(x.institution)} / ${esc(x.subject)}</strong><span>${esc(x.file_name||'Belge')}</span></div><div class="row-actions"><button class="reject-match subtle-action" data-id="${x.id}">Reddet</button><button class="approve-match primary-action" data-id="${x.id}">Eşleştir</button></div></div>`).join(''):empty('Müzekkere cevap eşleştirme önerisi yok.');
 const docsBody=d.documents.length?d.documents.map(x=>`<a class="cockpit-doc" href="#documents/${x.id}"><strong>${esc(x.file_name)}</strong><span>${esc(x.document_kind||x.classification||'belge')} · ${esc(fmt(x.analyzed_at))}</span></a>`).join(''):empty('Föye bağlı indeksli belge yok.');
 const radarBody=d.radar.length?d.radar.map(x=>`<div class="cockpit-row"><div><strong>${esc(x.title)}</strong><span>${esc(x.detail||'')}</span></div>${badge(x.severity,x.severity==='critical'?'red':x.severity==='action'?'blue':'')}</div>`).join(''):empty('Açık iş radarı kaydı yok.');
 const repBody=d.representation.length?d.representation.map(x=>`<div class="cockpit-row"><div><strong>${esc(x.court||h.court||'Dosya')}</strong><span>${esc((x.problems||[]).join(' · ')||'Temsil bağlantısı tamam')}</span></div>${badge(x.status==='ok'?'Tamam':'Kontrol',x.status==='ok'?'green':'red')}</div>`).join(''):empty('Vekâlet/temsil verisi yok.');

 const hero=`<div class="case-header"><div class="crumb"><a href="#hearings">Duruşmalar</a> / ${esc(h.file_no||h.court_file_no||('#'+h.id))}</div><h1>${esc(h.court||'Duruşma')}</h1><div class="chips"><span class="chip">${esc(fmt(h.starts_at))}</span><span class="chip">${esc(h.court_file_no||'')}</span><span class="chip">${esc(h.client_name||'')}</span><span class="chip">${esc(h.location||'Yer bilgisi yok')}</span></div></div>`;
 const actions=`<div class="file-actionbar"><button id="scanOrders" class="subtle-action">Ara Kararları Tara</button><button id="scanMatches" class="subtle-action">Müzekkere Cevabı Ara</button><button id="generatePack" class="primary-action">Hazırlık Paketi</button></div>`;
 mount(hero+actions+`<div class="dashboard-grid"><div class="section-stack">
   ${section('Ara Karar Motoru','§',orderBody)}
   ${section('Son Belgeler','▤',docsBody)}
   ${section('Müzekkere Takibi','✉',corrBody)}
   ${section('Eşleştirme Önerileri','↔',matchBody)}
 </div><div class="section-stack">
   ${section('Açık Süreler','◷',deadlineBody)}
   ${section('Fiziksel İş Radarı','◎',radarBody)}
   ${section('Vekâlet / Temsil','♙',repBody)}
 </div></div>`,'hearings');

 document.querySelector('#scanOrders')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;e.currentTarget.textContent='Taranıyor…';await api.scanInterimOrders({officeFileId:h.office_file_id});renderCockpit(id)});
 document.querySelector('#scanMatches')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;e.currentTarget.textContent='Taranıyor…';await api.scanCorrespondenceMatches({officeFileId:h.office_file_id});renderCockpit(id)});
 document.querySelector('#generatePack')?.addEventListener('click',async()=>{const p=await api.generateHearingPack(h.office_file_id);location.hash='#cases/'+h.office_file_id+'/pack/'+p.id});
 document.querySelectorAll('.resolve-order').forEach(b=>b.onclick=async()=>{b.disabled=true;await api.resolveInterimOrder(b.dataset.id);renderCockpit(id)});
 document.querySelectorAll('.approve-match').forEach(b=>b.onclick=async()=>{b.disabled=true;await api.decideCorrespondenceMatch(b.dataset.id,true);renderCockpit(id)});
 document.querySelectorAll('.reject-match').forEach(b=>b.onclick=async()=>{b.disabled=true;await api.decideCorrespondenceMatch(b.dataset.id,false);renderCockpit(id)});
}
