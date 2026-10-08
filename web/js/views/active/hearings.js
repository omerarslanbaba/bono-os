import {api} from '../../api.js';
import {mount,pageHero,section,empty,esc,badge} from '../../ui.js';

const WD=['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'],MN=['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const key=d=>d.toISOString().slice(0,10),dt=v=>v?String(v).replace('T',' ').slice(0,16):'—';
function monthCard(base,rows){
  const y=base.getFullYear(),m=base.getMonth(),first=new Date(y,m,1),last=new Date(y,m+1,0),offset=(first.getDay()+6)%7,cells=[];
  for(let i=0;i<offset;i++)cells.push('<div class="cal-day muted"></div>');
  for(let day=1;day<=last.getDate();day++){
    const d=new Date(y,m,day),events=rows.filter(h=>String(h.starts_at||'').slice(0,10)===key(d));
    const ev=events.slice(0,3).map(h=>`<a class="cal-event" href="#hearings/${h.id}" title="${esc((h.court||'')+' '+(h.court_file_no||''))}"><b>${esc(String(h.starts_at||'').slice(11,16))}</b> ${esc(h.court_file_no||'')}<span>${esc(h.court||'')}</span></a>`).join('');
    cells.push(`<div class="cal-day ${events.length?'has-event':''}"><div class="cal-no">${day}</div>${ev}${events.length>3?`<div class="cal-more">+${events.length-3} duruşma</div>`:''}</div>`);
  }
  return `<div class="month-card"><div class="month-title">${MN[m]} ${y}</div><div class="cal-weekdays">${WD.map(x=>`<span>${x}</span>`).join('')}</div><div class="cal-grid">${cells.join('')}</div></div>`;
}

export async function renderHearings(id){
  if(id){
    const d=await api.hearingCockpit(id),h=d.hearing;
    const docs=(d.documents||[]).length?(d.documents||[]).map(x=>`<div class="notice-row"><div><div class="doc-title">${esc(x.file_name)}</div><div class="doc-meta">${esc(x.document_kind||x.classification||'belge')}</div></div></div>`).join(''):empty('İndeksli belge yok.');
    const rep=(d.representation||[]).length?(d.representation||[]).map(x=>`<div class="notice-row"><div><div class="doc-title">${esc(x.court||h.court||'Dosya')}</div><div class="doc-meta">${esc((x.problems||[]).join(' · ')||'Temsil bağlantısı tamam')}</div></div>${badge(x.status==='ok'?'Tamam':'Kontrol',x.status==='ok'?'green':'red')}</div>`).join(''):empty('Vekâlet/temsil verisi yok.');
    mount(`<div class="case-header"><a class="back-link" href="#hearings">← Duruşmalara dön</a><h1>${esc(h.court||'Duruşma')}</h1><div class="chips"><span class="chip">${esc(dt(h.starts_at))}</span><span class="chip">${esc(h.court_file_no||'')}</span></div></div><div class="grid"><div>${section('Belgeler','▤',docs)}</div><div>${section('Vekâlet / Temsil','♙',rep)}</div></div>`,'hearings');return;
  }
  const rows=await api.upcomingHearings(250),now=new Date(),months=[0,1,2].map(i=>new Date(now.getFullYear(),now.getMonth()+i,1));
  const action='<button id="syncCalendar" class="primary-action">Duruşma Takvimini Senkronize Et</button>';
  const calendars=`<div class="three-month-calendar">${months.map(m=>monthCard(m,rows)).join('')}</div>`;
  mount(pageHero('Duruşma Takvimi','UYAP duruşmaları üç aylık takvim görünümünde.')+section('3 Aylık Takvim','◷',calendars,action),'hearings');
  document.querySelector('#syncCalendar')?.addEventListener('click',async e=>{
    const start=new Date(now.getFullYear(),now.getMonth(),1),end=new Date(now.getFullYear(),now.getMonth()+3,0);
    e.currentTarget.disabled=true;e.currentTarget.textContent='UYAP senkronu kuyruğa alındı';
    try{await api.syncHearings(key(start),key(end));setTimeout(()=>renderHearings(),9000)}catch(err){alert(err.message);e.currentTarget.disabled=false}
  });
}