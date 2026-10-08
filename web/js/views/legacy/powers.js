import {api} from '../api.js';
import {mount,pageHero,section,empty,esc,badge} from '../ui.js';

export async function renderPowers(id){
 if(id)return renderPower(id);
 const rows=await api.powers();
 const body=rows.length?`<div class="data-table"><div class="data-head power-cols"><span>Müvekkil</span><span>Noter / Yevmiye</span><span>Tarih</span><span>Kaynak</span><span></span></div>${rows.map(r=>`<a class="data-row power-cols" href="#powers/${r.id}"><span><strong>${esc(r.client_name)}</strong><small>${esc(r.status||'active')}</small></span><span><strong>${esc(r.notary||'—')}</strong><small>${esc(r.journal_no||'—')}</small></span><span>${esc(r.issued_at||'—')}</span><span>${r.source_count}</span><span>→</span></a>`).join('')}</div>`:empty('Vekâlet kaydı yok.');
 mount(pageHero('Vekâlet Merkezi','Excel, yerel belge ve ileride UYAP kaynaklarını tek vekâlet kaydında birleştir.')+section('Vekâletler','♙',body),'powers');
}
async function renderPower(id){
 const p=await api.power(id);
 const sources=p.sources.length?p.sources.map(s=>{const ref=(s.local_path||s.source_ref||'').split(/[\\/]/).pop();return `<div class="notice-row"><div><div class="doc-title">${esc(ref||s.source_type)}</div><div class="doc-meta">${esc(s.source_type)} · ${esc(s.observed_at||'')}</div></div>${badge(s.source_type==='local_document'?'Yerel Belge':'Kayıt')}</div>`}).join(''):empty('Kaynak yok.');
 const cases=p.cases.length?p.cases.map(c=>`<div class="notice-row"><div><div class="doc-title">${esc(c.court||'UYAP Dosyası')}</div><div class="doc-meta">${esc(c.court_file_no||'')} · ${esc(c.case_type||'')}</div></div>${badge(c.status||'')}</div>`).join(''):empty('Bu vekâlet henüz bir UYAP dosyasına bağlanmadı.');
 mount(`<div class="case-header"><div class="crumb"><a href="#powers">Vekâletler</a> / #${p.id}</div><h1>${esc(p.client_name)} · Vekâlet</h1><div class="chips"><span class="chip">${esc(p.notary||'Noter yok')}</span><span class="chip">Yevmiye ${esc(p.journal_no||'—')}</span><span class="chip">${esc(p.issued_at||'—')}</span><span class="chip">${esc(p.status||'active')}</span></div></div><div class="grid"><div class="section-stack">${section('Kaynaklar','▤',sources)}</div><div class="section-stack">${section('Kullanıldığı UYAP Dosyaları','□',cases)}${section('Entegrasyon Mantığı','✦','<div class="empty">Aynı noter + yevmiye + tarih bilgisi UYAP’tan geldiğinde yeni kayıt açılmayacak; bu vekâlete kaynak ve dosya bağlantısı olarak eklenecek.</div>')}</div></div>`,'powers');
}