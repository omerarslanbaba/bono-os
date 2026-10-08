import {api} from '../../api.js';
import {mount,pageHero,section,empty,esc,badge,kpi} from '../../ui.js';

function extractLine(body,label){
  const line=String(body||'').split(/\r?\n/).find(x=>x.toLocaleLowerCase('tr-TR').startsWith(label.toLocaleLowerCase('tr-TR')+':'));
  return line?line.slice(line.indexOf(':')+1).trim():'—';
}
export async function renderAccounting(){
  const data=await api.accountingOverview();
  const converted=(data.converted||[]).map(x=>`<div class="notice-row accounting-row"><div><div class="doc-title">${esc(x.title)}</div><div class="doc-meta">${esc(extractLine(x.body,'Tarih'))} · ${esc(extractLine(x.body,'Tutar'))} · ${esc(x.court_file_no||x.office_file_no||'Dosya bilgisi yok')}</div><div class="accounting-source">${esc(extractLine(x.body,'Kaynak belge'))}</div></div>${badge('Nota dönüştürüldü','green')}</div>`).join('');
  const pending=(data.pending||[]).map(x=>`<a class="notice-row accounting-row clickable" href="#uyap/${x.case_id}"><div><div class="doc-title">${esc(x.remote_title||x.document_type||x.original_file_name||'Mali evrak')}</div><div class="doc-meta">${esc(x.document_date||'Tarih yok')} · ${esc(x.court_file_no||x.office_file_no||'Dosya bilgisi yok')}</div><div class="accounting-source">${esc(x.reason||'İnceleme bekliyor')}</div></div>${badge('İnceleme bekliyor')}</a>`).join('');
  mount(pageHero('Tahsilat / Reddiyat','Mali UYAP evraklarının özetleri ve otomatik işlenemeyen kayıtlar.')+
    `<div class="kpis accounting-kpis">${kpi('✓','Nota dönüştürülen',data.counts?.converted||0)}${kpi('!','İnceleme bekleyen',data.counts?.pending||0)}</div>`+
    `<div class="accounting-grid"><div>${section('Otomatik Notlar','₺',converted||empty('Henüz otomatik mali not yok.'))}</div><div>${section('İnceleme Bekleyenler','!',pending||empty('İnceleme bekleyen mali evrak yok.'))}</div></div>`,'accounting');
}
