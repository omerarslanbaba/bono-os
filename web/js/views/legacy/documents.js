import {api} from '../api.js';
import {mount,pageHero,section,empty,esc,badge} from '../ui.js';

export async function renderDocuments(id){
 if(id)return renderAsset(id);
 const rows=await api.assets();
 const action='<div class="head-actions"><button id="udfAnalyze" class="subtle-action">UDF Zekâsını Yenile</button><button id="scanBtn" class="primary-action">Belge Radarını Çalıştır</button></div>';
 const body=rows.length?`<div class="data-table"><div class="data-head asset-cols"><span>Belge</span><span>Tür</span><span>Eşleşen Müvekkil</span><span>Konum</span><span></span></div>${rows.map(r=>`<a class="data-row asset-cols" href="#documents/${r.id}"><span><strong>${esc(r.file_name)}</strong><small>${Math.round((r.size_bytes||0)/1024)} KB</small></span><span>${esc(r.classification||'belge')}</span><span>${esc(r.suggested_client||'—')}</span><span>${r.location_count}${r.location_count>1?' · duplicate':''}</span><span>→</span></a>`).join('')}</div>`:empty('Henüz indekslenmiş yerel belge yok.');
 mount(pageHero('Evraklar','Hash tabanlı arşiv + UDF belge zekâsı. Aynı belge farklı klasörlerdeyse tek varlık olarak tutulur.')+section('Yerel Belge İndeksi','▤',body,action),'documents');
 document.querySelector('#scanBtn').onclick=async e=>{const b=e.currentTarget;b.disabled=true;b.textContent='Kuyruğa alındı…';await api.enqueue('scan_documents',{},'manual-scan:'+Date.now(),60);setTimeout(()=>renderDocuments(),1600)};
 document.querySelector('#udfAnalyze').onclick=async e=>{const b=e.currentTarget;b.disabled=true;b.textContent='UDF analizi kuyruğa alındı…';await api.enqueue('analyze_udf_library',{},'manual-udf:'+Date.now(),45);setTimeout(()=>renderDocuments(),2200)};
}
async function renderAsset(id){
 const a=await api.asset(id);let an=null;try{an=await api.documentAnalysis(id)}catch{}
 const locs=a.locations.length?a.locations.map(l=>`<div class="notice-row"><div><div class="doc-title">${esc(l.local_path)}</div><div class="doc-meta">${esc(l.source_root||'')} · ${esc(l.last_seen_at||'')}</div></div></div>`).join(''):empty('Konum kaydı yok.');
 let intelligence=empty('Bu belge için yapılandırılmış analiz yok. UDF ise UDF Zekâsını Yenile komutuyla analiz edilebilir.');
 let style=empty('Stil bilgisi yok.');
 if(an){
  const ex=an.extracted||{},secs=Array.isArray(an.sections)?an.sections:[],sp=an.style_profile||{};
  const fieldRows=[['Mahkeme / merci',(ex.courtCandidates||[]).join(' · ')],['Dosya no',(ex.caseNumbers||[]).join(' · ')],['Tarihler',(ex.dates||[]).slice(0,8).join(' · ')],['Tutarlar',(ex.amounts||[]).slice(0,8).join(' · ')]].map(([k,v])=>`<div class="kv-row"><span>${k}</span><strong>${esc(v||'—')}</strong></div>`).join('');
  const secRows=secs.length?secs.map(s=>`<span class="chip">${esc(s.heading)}</span>`).join(''): '<span class="doc-meta">Bölüm başlığı çıkarılamadı</span>';
  intelligence=`<div class="analysis-summary"><div class="analysis-score"><strong>${Math.round((an.template_score||0)*100)}%</strong><span>Dilekçe şablon skoru</span></div><div class="kv-stack">${fieldRows}</div><div class="chips section-chips">${secRows}</div><details><summary>Metin önizlemesi</summary><pre class="text-preview">${esc(an.textPreview||'')}</pre></details></div>`;
  style=`<div class="kv-stack"><div class="kv-row"><span>Font</span><strong>${esc((sp.fonts||[]).map(x=>x[0]).slice(0,3).join(', ')||'—')}</strong></div><div class="kv-row"><span>Boyut</span><strong>${esc((sp.sizes||[]).map(x=>x[0]).slice(0,3).join(', ')||'—')}</strong></div><div class="kv-row"><span>Paragraf</span><strong>${esc(sp.paragraphCount||0)}</strong></div><div class="kv-row"><span>Header</span><strong>${sp.headerText?'Var':'Yok'}</strong></div><div class="kv-row"><span>Footer</span><strong>${sp.footerText?'Var':'Yok'}</strong></div></div>`;
 }
 mount(`<div class="case-header"><div class="crumb"><a href="#documents">Evraklar</a> / #${a.id}</div><h1>${esc(a.file_name)}</h1><div class="chips"><span class="chip">${esc(a.classification||'belge')}</span><span class="chip">${esc(a.extension||'')}</span><span class="chip">${Math.round((a.size_bytes||0)/1024)} KB</span>${a.suggested_client?`<span class="chip">${esc(a.suggested_client)}</span>`:''}${an?'<span class="chip gold-chip">Belge Zekâsı ✓</span>':''}</div></div>`+
 `<div class="grid"><div class="section-stack">${section('Belge Zekâsı','✦',intelligence)}${section('Bu Evrakta Ara','⌕','<div class="evidence-search"><input id="docSearch" placeholder="Bu evrakta ara…"><button id="docSearchBtn" class="primary-action">Ara</button></div><div id="docSearchResults"></div>')}</div><div class="section-stack">${section('UDF Stil / Antet Profili','✎',style)}${section('Bulunduğu Konumlar','▤',locs)}${section('Duplicate Kontrolü','◆',`<div class="empty">SHA-256: <span class="mono">${esc(a.sha256||'')}</span><br><br>Aynı hash tekrar görülürse yeni evrak oluşturulmaz.</div>`)}</div></div>`,'documents');
 document.querySelector('#docSearchBtn').onclick=async()=>{const q=document.querySelector('#docSearch').value.trim(),box=document.querySelector('#docSearchResults');if(q.length<2)return;const d=await api.knowledgeSearch(q,{assetId:id});box.innerHTML=d.results.length?d.results.map(r=>`<div class="evidence-hit"><div><strong>${esc(r.heading||r.file_name)}</strong></div><p>${esc(r.preview)}</p></div>`).join(''):empty('Eşleşme bulunamadı.')};
}