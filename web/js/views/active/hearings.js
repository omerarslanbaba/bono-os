import {api} from '../../api.js';
import {mount,pageHero,section,empty,esc,badge} from '../../ui.js';

const WD=['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];
const MN=['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const state={anchor:new Date(new Date().getFullYear(),new Date().getMonth(),1),mode:'month'};
const key=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const dt=v=>v?String(v).replace('T',' ').slice(0,16):'—';
const monday=d=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-((x.getDay()+6)%7));return x};
const addDays=(d,n)=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()+n);return x};
const activeDates=()=>{
 if(state.mode==='week')return Array.from({length:7},(_,i)=>addDays(monday(state.anchor),i));
 const first=new Date(state.anchor.getFullYear(),state.anchor.getMonth(),1);
 const start=monday(first),end=new Date(first.getFullYear(),first.getMonth()+1,0);
 const count=Math.ceil((((end-start)/86400000)+1)/7)*7;
 return Array.from({length:count},(_,i)=>addDays(start,i));
};
function calendar(rows){
 const dates=activeDates(),weekly=state.mode==='week';
 const title=weekly?dt(key(dates[0]))+' — '+dt(key(dates[6])):MN[state.anchor.getMonth()]+' '+state.anchor.getFullYear();
 const cells=dates.map(d=>{
  const outside=!weekly&&d.getMonth()!==state.anchor.getMonth();
  const events=rows.filter(h=>String(h.starts_at||'').slice(0,10)===key(d));
  const items=events.map(h=>`<a class="cal-event" href="#hearings/${encodeURIComponent(h.id)}" title="${esc((h.court||'')+' · '+(h.court_file_no||''))}"><b>${esc(String(h.starts_at||'').slice(11,16))}</b> ${esc(h.court_file_no||'')}<span>${esc(h.court||'')}</span></a>`).join('');
  return `<div class="cal-day ${outside?'muted':''} ${events.length?'has-event':''}"><div class="cal-no">${d.getDate()}</div>${items}</div>`;
 }).join('');
 return `<div class="bono-calendar-controls"><button type="button" id="prevPeriod" class="subtle-action" aria-label="Önceki dönem">← Önceki</button><strong class="bono-calendar-heading">${esc(title)}</strong><button type="button" id="nextPeriod" class="subtle-action" aria-label="Sonraki dönem">Sonraki →</button><button type="button" id="thisPeriod" class="subtle-action">Bugün</button><div class="bono-calendar-modes"><button type="button" id="viewMonth" class="uyap-filter ${!weekly?'active':''}">Ay</button><button type="button" id="viewWeek" class="uyap-filter ${weekly?'active':''}">Hafta</button></div></div><div class="bono-calendar-full ${weekly?'week-view':'month-view'}"><div class="cal-weekdays">${WD.map(x=>`<span>${x}</span>`).join('')}</div><div class="cal-grid">${cells}</div></div>`;
}
export async function renderHearings(id){
 if(id){
  const d=await api.hearingCockpit(id),h=d.hearing;
  const docs=(d.documents||[]).length?(d.documents||[]).map(x=>`<div class="notice-row"><div><div class="doc-title">${esc(x.file_name)}</div><div class="doc-meta">${esc(x.document_kind||x.classification||'belge')}</div></div></div>`).join(''):empty('İndeksli belge yok.');
  const rep=(d.representation||[]).length?(d.representation||[]).map(x=>`<div class="notice-row"><div><div class="doc-title">${esc(x.court||h.court||'Dosya')}</div><div class="doc-meta">${esc((x.problems||[]).join(' · ')||'Temsil bağlantısı tamam')}</div></div>${badge(x.status==='ok'?'Tamam':'Kontrol',x.status==='ok'?'green':'red')}</div>`).join(''):empty('Vekâlet/temsil verisi yok.');
  mount(`<div class="case-header"><a class="back-link" href="#hearings">← Duruşmalara dön</a><h1>${esc(h.court||'Duruşma')}</h1><div class="chips"><span class="chip">${esc(dt(h.starts_at))}</span><span class="chip">${esc(h.court_file_no||'')}</span></div></div><div class="grid"><div>${section('Belgeler','▤',docs)}</div><div>${section('Vekâlet / Temsil','♙',rep)}</div></div>`,'hearings');return;
 }
 const rows=await api.upcomingHearings(250);
 const action='<button id="syncCalendar" class="primary-action">Duruşma Takvimini Senkronize Et</button>';
 mount(pageHero('Duruşma Takvimi','UYAP duruşmaları: aylık ve haftalık görünüm.')+section('Takvim','◷',`<div id="hearingCalendarArea">${calendar(rows)}</div>`,action),'hearings');
 const draw=()=>{const el=document.querySelector('#hearingCalendarArea');if(!el)return;el.innerHTML=calendar(rows);const move=n=>{const d=state.anchor;state.anchor=state.mode==='week'?addDays(d,n*7):new Date(d.getFullYear(),d.getMonth()+n,1);draw()};
  el.querySelector('#prevPeriod').onclick=()=>move(-1);el.querySelector('#nextPeriod').onclick=()=>move(1);
  el.querySelector('#thisPeriod').onclick=()=>{const now=new Date();state.anchor=new Date(now.getFullYear(),now.getMonth(),now.getDate());draw()};
  el.querySelector('#viewMonth').onclick=()=>{state.mode='month';draw()};
  el.querySelector('#viewWeek').onclick=()=>{state.mode='week';draw()};
 };
 draw();
 document.querySelector('#syncCalendar')?.addEventListener('click',async e=>{
  const start=activeDates()[0],end=activeDates().at(-1);
  e.currentTarget.disabled=true;e.currentTarget.textContent='UYAP senkronu kuyruğa alındı';
  try{await api.syncHearings(key(start),key(end));setTimeout(()=>renderHearings(),9000)}catch(err){alert(err.message);e.currentTarget.disabled=false}
 });
}
