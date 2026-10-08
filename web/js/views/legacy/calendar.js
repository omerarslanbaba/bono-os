import {api} from '../api.js';
import {mount,kpi,pageHero,section,empty,esc,demo} from '../ui.js';

function cells(events=[]){
 const now=new Date(),y=now.getFullYear(),m=now.getMonth(),first=new Date(y,m,1),start=(first.getDay()+6)%7,days=new Date(y,m+1,0).getDate(),prev=new Date(y,m,0).getDate();
 const map=new Map(); for(const e of events){if(!e.when)continue;const d=new Date(e.when);if(d.getFullYear()===y&&d.getMonth()===m){const a=map.get(d.getDate())||[];a.push(e);map.set(d.getDate(),a)}}
 let out=[];for(let i=start-1;i>=0;i--)out.push({n:prev-i,muted:true});
 for(let d=1;d<=days;d++)out.push({n:d,selected:d===now.getDate(),events:map.get(d)||[]});
 let n=1;while(out.length%7)out.push({n:n++,muted:true});return out;
}
export async function renderCalendar(){
 const [b,s]=await Promise.all([api.brief(),api.summary()]);
 const now=new Date(),month=new Intl.DateTimeFormat('tr-TR',{month:'long',year:'numeric'}).format(now);
 const ev=demo?[{kind:'hearing',when:new Date(now.getFullYear(),now.getMonth(),8,10).toISOString(),title:'Duruşma'},{kind:'deadline',when:new Date(now.getFullYear(),now.getMonth(),14,12).toISOString(),title:'Süre Sonu'},{kind:'task',when:new Date(now.getFullYear(),now.getMonth(),18,9).toISOString(),title:'Toplantı'}]:b.items;
 const cs=cells(ev);
 const calendar=`<div class="card calendar"><div class="calendar-head"><h2>${month[0].toUpperCase()+month.slice(1)}</h2><div class="calendar-actions"><button class="active">Ay</button><button>Hafta</button><button>Gün</button><button>Ajanda</button></div></div><div class="weekdays">${['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'].map(x=>`<div>${x}</div>`).join('')}</div><div class="days">${cs.map(x=>`<div class="day ${x.muted?'muted':''} ${x.selected?'selected':''}"><div>${x.n}</div>${(x.events||[]).slice(0,2).map(e=>`<div class="event">● ${esc(e.title||e.kind)}</div>`).join('')}</div>`).join('')}</div></div>`;
 const agenda=b.items.length?b.items.slice(0,8).map(e=>`<div class="deadline-row"><div class="brief-when">${esc(String(e.when||'').slice(11,16)||'')}</div><div><div class="doc-title">${esc(e.title)}</div><div class="doc-meta">${esc(e.subtitle||e.kind)}</div></div></div>`).join(''):empty('Bugün için ajanda kaydı yok.');
 mount(pageHero('Takvim ve Süreler','Duruşma, toplantı, görev ve hukuki süreleri tek çalışma alanında izle.',demo?'DEMO VERİSİ':'')+`<div class="kpis">${kpi('⚖','Bugünkü duruşma',b.todayHearings)}${kpi('◷','7 günlük süre',b.urgentDeadlines)}${kpi('✓','Bugünkü görev',b.todayTasks)}${kpi('✉','Yeni tebligat',b.newNotifications)}</div><div class="calendar-layout">${calendar}<div class="section-stack">${section('Günün Ajandası','▣',agenda)}${section('Süre Güvenliği','◷',`<div class="empty"><strong>${s.unapprovedDeadlines}</strong> hukuki süre avukat onayı bekliyor.</div>`)}</div></div>`,'calendar');
}