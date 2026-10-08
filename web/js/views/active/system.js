import {api} from '../../api.js';
import {mount,pageHero,section,empty,esc,badge} from '../../ui.js';

function stateLabel(v){
  const s=String(v||'').toLowerCase();
  if(s==='ok')return 'Çalışıyor';
  if(s==='active')return 'Aktif';
  if(s==='failed')return 'Hata';
  if(s==='queued')return 'Bekliyor';
  if(s==='running')return 'Çalışıyor';
  return v||'Bilinmiyor';
}
function serviceLabel(v){
  const s=String(v||'').toLowerCase();
  if(s==='server')return 'Sunucu';
  if(s==='worker')return 'Arka plan servisi';
  return v||'Servis';
}
function modeLabel(v){
  const s=String(v||'').toLowerCase();
  if(s==='browser_readonly')return 'Salt okunur';
  if(s.includes('readonly'))return 'Salt okunur';
  return v||'Bilinmiyor';
}
function infoRow(label,value,meta=''){
  return `<div class="system-row"><span>${esc(label)}</span><div><strong>${esc(value)}</strong>${meta?`<small>${esc(meta)}</small>`:''}</div></div>`;
}
export async function renderSystem(){
  const [health,uyap,jobs]=await Promise.all([api.serviceHealth(),api.uyapStatus(),api.jobs()]);
  const failed=jobs.filter(x=>x.status==='failed').length;
  const queued=jobs.filter(x=>x.status==='queued'||x.status==='running').length;
  const services=health.length?health.map(x=>`<div class="notice-row"><div><div class="doc-title">${esc(serviceLabel(x.service))}</div><div class="doc-meta">Son kontrol: ${esc(x.last_heartbeat_at||'—')}</div></div>${badge(stateLabel(x.state),x.state==='ok'?'green':'red')}</div>`).join(''):empty('Servis bilgisi yok.');
  const connection=`<div class="system-summary">${infoRow('UYAP bağlantısı',modeLabel(uyap.rate?.integration_mode))}${infoRow('Onaylı bağlantı noktası',uyap.endpointCount||0)}${infoRow('Gözlem kaydı',uyap.observationCount||0)}${infoRow('Bekleyen işler',queued)}${infoRow('Hatalı işler',failed,failed?'Kontrol gerekli':'Sorun yok')}</div>`;
  mount(pageHero('Sistem','BONO OS servisleri ve UYAP bağlantısının kısa durum özeti.')+`<div class="system-grid"><div>${section('Servis Durumu','●',services)}</div><div>${section('Bağlantı Özeti','⚖',connection)}</div></div>`,'system');
}
