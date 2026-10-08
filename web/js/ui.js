import {api} from './api.js';

export const nav=[['Bugün','today'],['Dosyalarım','uyap'],['Duruşmalar','hearings'],['Vekâletler','powers'],['Sistem','system']];
export function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
export function mark(){return '<img class="mark" src="/assets/bono-os-logo.png" alt="BONO OS" />'}
export function icon(name){return ({today:'◫',uyap:'⚖',hearings:'◷',powers:'♙',accounting:'₺',system:'●'}[name]||'•')}
export function panelToggleIcon(){return '<svg class="panel-toggle-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2.5"></rect><line x1="11.5" y1="4.5" x2="11.5" y2="19.5"></line></svg>'}
export function kpi(i,label,value){return `<div class="card kpi"><div class="kpi-icon">${i}</div><div><small>${esc(label)}</small><strong>${esc(value)}</strong></div></div>`}
export function layout(content,active='today'){
  const collapsed=localStorage.getItem('bonoSidebar')==='collapsed';
  return `<div class="shell ${collapsed?'sidebar-collapsed':''}"><aside class="sidebar"><div class="brand">${mark()}<div class="brand-text"><div class="brand-title">BONO OS</div><div class="brand-sub">Hukuk Operasyon Sistemi</div></div></div><button id="sidebarToggle" class="sidebar-toggle" title="${collapsed?'Menüyü aç':'Menüyü daralt'}" aria-label="${collapsed?'Menüyü aç':'Menüyü daralt'}">${panelToggleIcon()}</button><nav class="nav">${nav.map(([label,key])=>`<a class="nav-item ${active===key?'active':''}" href="#${key}" title="${esc(label)}"><span class="nav-icon">${icon(key)}</span><span class="nav-label">${label}</span></a>`).join('')}</nav></aside><main class="main"><div id="uyapSessionAlert" class="uyap-session-alert" hidden></div><header class="topbar"><div class="search-wrap"><div class="search"><span>⌕</span><input id="globalSearch" autocomplete="off" placeholder="Dosya, müvekkil, esas no veya evrak ara"><span class="shortcut">Ctrl K</span></div><div id="searchResults" class="search-results"></div></div><div class="top-spacer"></div><div class="sync" id="topSync"><span class="dot"></span><span>Hazır</span></div></header><section class="content">${content}</section></main></div>`;
}
async function refreshUyapSessionAlert(){
  const box=document.querySelector('#uyapSessionAlert'),sync=document.querySelector('#topSync');
  if(!box)return;
  try{
    const x=await api.uyapSession(),s=x?.session||{},expired=s.state==='login_required';
    box.hidden=!expired;
    box.innerHTML=expired?`<strong>UYAP oturumu kapandı.</strong><span> Belge indirmeleri durduruldu. UYAP'a yeniden giriş yaptığında otomatik devam edecek.</span>`:'';
    if(sync){
      sync.classList.toggle('session-error',expired);
      const label=sync.querySelector('span:last-child');if(label)label.textContent=expired?'UYAP giriş bekliyor':'Hazır';
    }
  }catch{}
}
function bindUyapSessionWatcher(){
  refreshUyapSessionAlert();
  if(window.__BONO_UYAP_SESSION_WATCHER__)return;
  window.__BONO_UYAP_SESSION_WATCHER__=setInterval(refreshUyapSessionAlert,4000);
}
export function mount(content,active){document.querySelector('#app').innerHTML=layout(content,active);bindGlobalSearch();bindSidebar();bindUyapSessionWatcher()}
function bindSidebar(){const b=document.querySelector('#sidebarToggle'),s=document.querySelector('.shell');if(!b||!s)return;b.onclick=()=>{const c=s.classList.toggle('sidebar-collapsed');localStorage.setItem('bonoSidebar',c?'collapsed':'open');b.title=c?'Menüyü aç':'Menüyü daralt';b.setAttribute('aria-label',b.title)}}
const quickCommands=[{title:'Bugün',subtitle:'Günlük özet',href:'#today'},{title:'Dosyalarım',subtitle:'Dosya ve evrak senkronu',href:'#uyap'},{title:'Duruşmalar',subtitle:'Yaklaşan duruşmalar',href:'#hearings'},{title:'Vekâletler',subtitle:'Vekâlet kayıtları',href:'#powers'},{title:'Sistem',subtitle:'Bağlantı ve servis durumu',href:'#system'}];
function bindGlobalSearch(){const input=document.querySelector('#globalSearch'),box=document.querySelector('#searchResults');if(!input||!box)return;const show=q=>{const n=q.toLocaleLowerCase('tr-TR');const hits=quickCommands.filter(c=>(c.title+' '+c.subtitle).toLocaleLowerCase('tr-TR').includes(n));box.innerHTML=hits.map(c=>`<a class="search-hit command-hit" href="${c.href}"><strong>${esc(c.title)}</strong><span>${esc(c.subtitle)}</span></a>`).join('');box.classList.add('show')};input.onfocus=()=>show(input.value.trim());input.oninput=()=>show(input.value.trim());input.onkeydown=e=>{if(e.key==='Escape'){box.classList.remove('show');input.blur()}if(e.key==='Enter'){box.querySelector('a')?.click()}};if(!window.__BONO_SHORTCUTS__){window.__BONO_SHORTCUTS__=true;window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();document.querySelector('#globalSearch')?.focus()}})}}
export function section(title,iconText,body,action=''){return `<div class="card panel"><div class="panel-head"><span class="head-icon">${iconText}</span><h2>${esc(title)}</h2>${action}</div>${body}</div>`}
export function empty(msg){return `<div class="empty">${esc(msg)}</div>`}
export function badge(text,cls=''){return `<span class="badge ${cls}">${esc(text)}</span>`}
export function pageHero(title,subtitle=''){return `<div class="hero"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div></div>`}
