import {api} from '../../api.js';
import {mount,pageHero,section,empty,esc} from '../../ui.js';
function copyRow(label,value,source=''){
  const shown=value||'Henüz tespit edilmedi',safe=esc(shown);
  return `<div class="client-field"><span>${esc(label)}</span><div class="field-value"><strong>${safe}</strong>${source&&value?`<small class="field-source">Kaynak: ${esc(source)}</small>`:''}</div>${value?`<button class="copy-field" data-copy="${esc(value)}" title="${esc(label)} bilgisini kopyala">⧉</button>`:'<span></span>'}</div>`;
}
export async function renderPowers(id){
  if(id){
    const p=await api.power(id),src=p.field_sources||{};
    const client=`<div class="client-card">${copyRow('Ad Soyad',p.client_name)}${copyRow('TCKN',p.national_id,src.national_id)}${copyRow('Doğum Tarihi',p.birth_date,src.birth_date)}${copyRow('Adres',p.address,src.address)}${copyRow('Telefon',p.phone,src.phone)}${copyRow('E-posta',p.email,src.email)}</div>`;
    const powerInfo=`<div class="power-summary">${copyRow('Noter',p.notary)}${copyRow('Yevmiye No',p.journal_no)}${copyRow('Tarih',p.issued_at)}</div>`;
    const hasDoc=(p.sources||[]).some(s=>s.local_path);
    const view=hasDoc?`<a class="primary-action document-open" href="/api/powers/${p.id}/document" target="_blank">Vekâleti Görüntüle</a>`:'<button class="subtle-action" disabled>Vekâlet Belgesi Bulunamadı</button>';
    mount(`<div class="case-header"><a class="back-link" href="#powers">← Vekâletlere dön</a><h1>${esc(p.client_name||'Vekâlet')}</h1><p class="detail-subtitle">Müvekkil ve vekâlet bilgileri</p></div><div class="power-detail-grid"><div>${section('Müvekkil Bilgileri','♙',client)}</div><div>${section('Vekâlet Bilgileri','▤',powerInfo,`<div class="head-actions">${view}</div>`)}</div></div>`,'powers');
    document.querySelectorAll('.copy-field').forEach(b=>b.onclick=async()=>{const v=b.getAttribute('data-copy')||'';await navigator.clipboard.writeText(v);const old=b.textContent;b.textContent='✓';b.classList.add('copied');setTimeout(()=>{b.textContent=old;b.classList.remove('copied')},900)});
    return;
  }
  const rows=await api.powers();
  const body=rows.length?`<div class="power-list">${rows.map(r=>`<a class="power-list-row no-status" href="#powers/${r.id}"><div><strong>${esc(r.client_name)}</strong><span>${esc(r.notary||'Noter bilgisi yok')} · ${esc(r.journal_no||'Yevmiye yok')} · ${esc(r.issued_at||'Tarih yok')}</span></div><span class="power-open">Aç</span></a>`).join('')}</div>`:empty('Vekâlet kaydı yok.');
  mount(pageHero('Vekâletler','Müvekkil ve vekâlet bilgileri doğrudan erişilebilir.')+section('Vekâlet Kayıtları','♙',body),'powers');
}
