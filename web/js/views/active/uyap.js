import {api} from '../../api.js';
import {mount,pageHero,section,empty,esc,badge} from '../../ui.js';

function discoveryBar(s,a){
  const active=(s.queued||0)+(s.running||0);
  const d=a.discovery||{};
  const c=a.cbs||{};
  const cbsUnits=(c.units?.queued||0)+(c.units?.running||0);
  const cbsSearch=(c.search?.queued||0)+(c.search?.running||0);
  const state=active?'Tam arşiv senkronizasyonu çalışıyor':'Tam arşiv senkronizasyonu hazır';
  const detail=`Keşif: ${d.completed||0} tamamlandı · ${d.queued||0} bekliyor · CBS birim: ${cbsUnits} · CBS dosya: ${cbsSearch} · Hata: ${a.failedCommands||0}`;
  return `<div class="uyap-discovery">
    <div class="uyap-discovery-stats">
      <div><strong>${a.cases||s.totalCases||0}</strong><span>Dosya</span></div>
      <div><strong>${a.remoteDocuments||0}</strong><span>Toplam evrak</span></div>
      <div><strong>${a.indexed||0}</strong><span>BONO’da</span></div>
      <div><strong>${(a.waiting||0)+(a.downloadQueued||0)}</strong><span>İndirilecek</span></div>
      <div><strong>${a.review||0}</strong><span>İnceleme</span></div>
      <div><strong>${a.skipped||0}</strong><span>Otomatik elendi</span></div>
    </div>
    <div class="uyap-discovery-actions">
      <span class="discovery-state">${esc(state)}<small>${esc(detail)}</small></span>
      <button id="syncAllUyap" class="primary-action" ${active?'disabled':''}>Tam UYAP Arşivini Başlat</button>
    </div>
  </div>`;
}

function caseCategory(r){
  const x=(String(r.court||'')+' '+String(r.case_type||'')).toLocaleLowerCase('tr-TR');
  if(/aile/.test(x))return 'Aile';
  if(/iş mah|iş dava|işçi|işçilik/.test(x))return 'İş';
  if(/tüketici/.test(x))return 'Tüketici';
  if(/icra|icra hukuk/.test(x))return 'İcra';
  if(/idare|vergi/.test(x))return 'İdare';
  if(/ceza|savcılık|soruşturma|cbs|infaz|sulh ceza/.test(x))return 'Ceza';
  if(/hukuk|ticaret|kadastro/.test(x))return 'Hukuk';
  return 'Diğer';
}

function docCategory(d){
  const x=(String(d.remote_title||'')+' '+String(d.document_type||'')+' '+String(d.original_file_name||'')).toLocaleLowerCase('tr-TR');
  if(/reddiyat|tahsilat|makbuz|ödeme|dekont|harç/.test(x))return 'Mali';
  if(/karar|gerekçeli/.test(x))return 'Kararlar';
  if(/dilekçe|beyan|savunma|cevap/.test(x))return 'Dilekçeler';
  if(/tutanak|duruşma/.test(x))return 'Tutanaklar';
  if(/bilirkişi|rapor|uzman/.test(x))return 'Raporlar';
  if(/tebliğ|teblig|mazbata/.test(x))return 'Tebligatlar';
  if(/müzekkere/.test(x))return 'Müzekkereler';
  return 'Diğer';
}

function extractLine(body,label){
  const line=String(body||'').split(/\r?\n/).find(x=>x.toLocaleLowerCase('tr-TR').startsWith(label.toLocaleLowerCase('tr-TR')+':'));
  return line?line.slice(line.indexOf(':')+1).trim():'—';
}

const JUDGMENT_TYPES=['Ceza','Hukuk','İcra','İdari Yargı','Satış Memurluğu','Arabuluculuk','CBS','Tazminat Komisyonu Başkanlığı'];
const JUDICIAL_UNITS={
  'Hukuk':['ASLİYE HUKUK MAHKEMESİ','ASLİYE TİCARET MAHKEMESİ','AİLE MAHKEMESİ','BAM Hukuk Dairesi(İlk Derece)','Bölge Adliye Mah. Hukuk Dairesi','FİKRİ VE SINAİ HAKLAR HUKUK MAHKEMESİ','KADASTRO MAHKEMESİ','KADASTRO MAHKEMESİ(MÜS)','SULH HUKUK MAHKEMESİ','TÜKETİCİ MAHKEMESİ','İCRA HUKUK MAHKEMESİ','İŞ MAHKEMESİ'],
  'Ceza':['AĞIR CEZA MAHKEMESİ','ASLİYE CEZA MAHKEMESİ','SULH CEZA HÂKİMLİĞİ','ÇOCUK MAHKEMESİ','ÇOCUK AĞIR CEZA MAHKEMESİ','İNFAZ HÂKİMLİĞİ','BAM Ceza Dairesi(İlk Derece)','Bölge Adliye Mah. Ceza Dairesi'],
  'İcra':['İCRA DAİRESİ','İFLAS DAİRESİ'],
  'İdari Yargı':['İDARE MAHKEMESİ','VERGİ MAHKEMESİ','BÖLGE İDARE MAHKEMESİ','DANIŞTAY'],
  'Satış Memurluğu':['SATIŞ MEMURLUĞU'],
  'Arabuluculuk':['ARABULUCULUK BÜROSU'],
  'CBS':['CUMHURİYET BAŞSAVCILIĞI'],
  'Tazminat Komisyonu Başkanlığı':['TAZMİNAT KOMİSYONU BAŞKANLIĞI']
};
function rootType(r){
  const s=String((r.court||'')+' '+(r.case_type||'')).toLocaleLowerCase('tr-TR');
  if(/tazminat komisyon/.test(s))return 'Tazminat Komisyonu Başkanlığı';
  if(/savcılık|başsavcılık|cbs|soruşturma/.test(s))return 'CBS';
  if(/arabulucu/.test(s))return 'Arabuluculuk';
  if(/satış memur/.test(s))return 'Satış Memurluğu';
  if(/icra dairesi|iflas dairesi/.test(s))return 'İcra';
  if(/idare mah|vergi mah|bölge idare|danıştay/.test(s))return 'İdari Yargı';
  if(/ceza|infaz hâkim|infaz hakim|çocuk mah/.test(s))return 'Ceza';
  return 'Hukuk';
}
function unit(r){
  const s=String(r.court||'').toLocaleUpperCase('tr-TR');
  const type=rootType(r),list=JUDICIAL_UNITS[type]||[];
  const aliases=[
    ['BAM HUKUK DAİRESİ(İLK DERECE)',/BAM.*HUKUK.*İLK DERECE/],
    ['BÖLGE ADLİYE MAH. HUKUK DAİRESİ',/BÖLGE ADLİYE.*HUKUK/],
    ['BAM CEZA DAİRESİ(İLK DERECE)',/BAM.*CEZA.*İLK DERECE/],
    ['BÖLGE ADLİYE MAH. CEZA DAİRESİ',/BÖLGE ADLİYE.*CEZA/]
  ];
  for(const [label,re] of aliases)if(re.test(s)&&list.some(x=>x.toLocaleUpperCase('tr-TR')===label))return list.find(x=>x.toLocaleUpperCase('tr-TR')===label);
  for(const label of list){
    const core=label.toLocaleUpperCase('tr-TR').replace(/\(.*?\)/g,'').replace(/BÖLGE ADLİYE MAH\./g,'BÖLGE ADLİYE').trim();
    if(core&&s.includes(core))return label;
  }
  return '';
}
function statusText(r){
  const s=String(r.status||'').toLocaleLowerCase('tr-TR');
  return /kapalı|closed|archiv|kesinleş|tamamlan/.test(s)?'Kapalı':'Açık';
}
function options(values){return [...new Set(values.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'tr')).map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('')}
function queryForm(rows){
  const years=rows.map(r=>String(r.court_file_no||'').match(/(20\d{2})\//)?.[1]);
  return `<div class="case-query"><div class="case-query-grid">
  <label>Yargı Türü<select id="filterType"><option value="">Tümü</option>${JUDGMENT_TYPES.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('')}</select></label>
  <label>Dosya Durumu<div class="case-state-toggle" role="group" aria-label="Dosya Durumu"><button type="button" class="state-option active" data-state="Açık">Açık</button><button type="button" class="state-option" data-state="Kapalı">Kapalı</button></div></label>
  <label>Yargı Birimi<select id="filterUnit"><option value="">Tümü</option></select></label>
  <label>Dosya Yıl / No<div class="case-year-row"><select id="filterYear"><option value="">Tümü</option>${options(years)}</select><input id="filterNo" placeholder="Dosya No"></div></label>
  <label>Mahkeme<select id="filterCourt"><option value="">Tümü</option></select></label>
  <label>Dosyada Ara<input id="filterQuery" placeholder="Föy no, mahkeme, esas no, müvekkil veya taraf"></label>
  </div><div class="case-query-actions"><span id="filterCount"></span><button id="resetFilters" type="button" class="subtle-action">Temizle</button><button id="applyFilters" type="button" class="primary-action">⌕ Sorgula</button></div></div>`;
}
function bindQuery(rows){
 const by=id=>document.getElementById(id),t=by('filterType'),u=by('filterUnit'),c=by('filterCourt');
 let selectedState='Açık';
 function set(el,vals){const old=el.value;el.innerHTML='<option value="">Tümü</option>'+options(vals);el.value=vals.includes(old)?old:''}
 function courts(){
   set(c,rows.filter(r=>(!t.value||rootType(r)===t.value)&&(!u.value||unit(r)===u.value)).map(r=>r.court));
 }
 function units(){
   const vals=t.value?(JUDICIAL_UNITS[t.value]||[]):JUDGMENT_TYPES.flatMap(x=>JUDICIAL_UNITS[x]||[]);
   set(u,vals);
   courts();
 }
 function apply(){
   const accepted=new Set(rows.filter(r=>{
    const number=String(r.court_file_no||''),match=number.match(/(20\d{2})\s*\/\s*(\d+)/);
    return (!t.value||rootType(r)===t.value)&&(!u.value||unit(r)===u.value)&&(!c.value||r.court===c.value)&&(statusText(r)===selectedState)&&(!by('filterYear').value||match?.[1]===by('filterYear').value)&&(!by('filterNo').value||String(match?.[2]||'').includes(by('filterNo').value.trim()))&&(!by('filterQuery').value||String([r.office_file_no,r.court,r.case_type,r.court_file_no,r.client_name,r.party_names].join(' ')).toLocaleLowerCase('tr-TR').includes(by('filterQuery').value.toLocaleLowerCase('tr-TR').trim()));
   }).map(x=>String(x.id)));
   document.querySelectorAll('.case-list-row').forEach(e=>e.hidden=!accepted.has(e.dataset.caseId));
   by('filterCount').textContent=accepted.size+' / '+rows.length+' dosya listeleniyor.';
 }
 document.querySelectorAll('.state-option').forEach(b=>b.onclick=()=>{selectedState=b.dataset.state;document.querySelectorAll('.state-option').forEach(x=>x.classList.toggle('active',x===b));apply()});
 t.onchange=units;u.onchange=courts;by('applyFilters').onclick=apply;
 by('resetFilters').onclick=()=>{document.querySelectorAll('.case-query input,.case-query select').forEach(e=>e.value='');selectedState='Açık';document.querySelectorAll('.state-option').forEach(x=>x.classList.toggle('active',x.dataset.state==='Açık'));units();apply()};
 by('filterQuery').oninput=apply;
 by('filterNo').oninput=apply;
 units();apply();
}

export async function renderUyap(id){
  if(id)return renderCase(id);
  const [rows,status,archive]=await Promise.all([api.uyapCases(),api.uyapDiscoveryStatus(),api.uyapArchiveStatus()]);
  const counts={};for(const r of rows){const c=caseCategory(r);counts[c]=(counts[c]||0)+1}
  const order=['Ceza','Hukuk','İş','Aile','İcra','Tüketici','İdare','Diğer'];
  const cats=['Tümü',...order.filter(x=>counts[x])];
  const filters=`<div class="document-categories case-categories">${cats.map((c,i)=>`<button class="category-chip ${i===0?'active':''}" data-case-cat="${esc(c)}">${esc(c)} <span>${c==='Tümü'?rows.length:counts[c]}</span></button>`).join('')}</div>`;
  const body=rows.length?`<div class="case-list-scroll">${rows.map(r=>{const cat=caseCategory(r);return `<a class="notice-row clickable case-list-row" data-case-id="${esc(r.id)}" data-case-category="${esc(cat)}" href="#uyap/${r.id}">
    <div><div class="doc-title"><span class="foy-badge ${r.office_file_no?'':'pending'}">${esc(r.office_file_no||'Föy Bekliyor')}</span>${esc(r.court||'Dosya')} · ${esc(r.court_file_no||'')}</div>
    <div class="doc-meta">${esc(cat)} · ${esc(r.case_type||'')} · ${r.remote_count||0} evrak · ${r.indexed_count||0} BONO’da${r.related_cases?.length?' · '+r.related_cases.length+' bağlantılı arabuluculuk':''}</div><div class="doc-meta case-party-inline">${r.client_name?`Müvekkil: ${esc(r.client_name)}`:''}${r.client_name&&r.party_names?' · ':''}${r.party_names?`Taraflar: ${esc(r.party_names)}`:(!r.client_name?'Taraf bilgisi henüz kaydedilmemiş':'')}</div></div><span>→</span>
  </a>`}).join('')}</div>`:empty('Henüz dosya keşfedilmedi.');
  mount(pageHero('Dosyalarım','Dosyaları yargı türü, birimi, mahkemesi ve esas numarasıyla sorgula.')+
    queryForm(rows)+discoveryBar(status,archive)+section('Dosya Sorgulama Sonuçları','⚖',body),'uyap');
  bindQuery(rows);
  // Sorgulama filtreleri bindQuery tarafından yönetilir.
  document.querySelector('#syncAllUyap')?.addEventListener('click',async e=>{
    e.currentTarget.disabled=true;e.currentTarget.textContent='Senkronizasyon başlatılıyor…';
    try{
      await api.startUyapArchive();
      e.currentTarget.textContent='Senkronizasyon arka planda çalışıyor';
    }catch(err){alert(err.message);e.currentTarget.disabled=false}
  });
}

function renderDocumentTree(docs,status){
 const folders=new Map();
 for(const doc of docs){const name=String(doc.document_type||doc.remote_title||'Diğer Evrak');if(!folders.has(name))folders.set(name,[]);folders.get(name).push(doc)}
 const ordered=[...folders.entries()].sort((a,b)=>a[0].localeCompare(b[0],'tr'));
 const groups=ordered.map(([name,items],i)=>`<details class="evrak-folder" ${i===0?'open':''}><summary>▱　${esc(name)} (${items.length})</summary><div class="evrak-folder-items">${items.map(x=>{const tag=x.local_asset_id?'a':'div',link=x.local_asset_id?` href="/api/assets/${x.local_asset_id}/content" target="_blank" rel="noopener"`:'';return `<${tag} class="evrak-entry ${x.local_asset_id?'clickable-document':''}"${link} data-doc-name="${esc(String([name,x.remote_title,x.original_file_name].join(' ')).toLocaleLowerCase('tr-TR'))}" data-doc-date="${esc(x.document_date||'')}"><div><strong>${esc(x.remote_title||x.original_file_name||name)}</strong><small>${esc(x.document_date||'')} · ${esc(status(x.status))}</small></div>${x.status==='summarized'?badge('Nota dönüştürüldü','green'):(x.status==='skipped'?badge('Arşiv dışı'):(x.status==='review'?badge('İncele'):(x.local_asset_id?badge('Aç','green'):badge('Bekliyor'))))}</${tag}>`}).join('')}</div></details>`).join('');
 return `<div class="evrak-tree-tools"><input id="evrakSearch" placeholder="Evrakta ara" aria-label="Evrakta ara"><button id="expandAllEvrak" class="subtle-action" type="button" title="Tüm klasörleri aç / kapat">▤</button><select id="evrakSort" aria-label="Sıralama"><option value="new">Yeni → Eski</option><option value="old">Eski → Yeni</option><option value="name">Adına göre</option></select></div><div class="evrak-tree"><div class="evrak-tree-root">▾　▱ Dosya Evrakları (${docs.length})</div>${groups||'<div class="empty">Evrak listesi henüz alınmadı.</div>'}</div>`;
}
function bindDocumentTree(){
 const search=document.getElementById('evrakSearch'),sort=document.getElementById('evrakSort');
 if(!search)return;
 function apply(){
  const q=search.value.trim().toLocaleLowerCase('tr-TR');
  document.querySelectorAll('.evrak-folder').forEach(folder=>{
    const entries=[...folder.querySelectorAll('.evrak-entry')];
    entries.sort((a,b)=>sort.value==='name'?a.dataset.docName.localeCompare(b.dataset.docName,'tr'):sort.value==='old'?a.dataset.docDate.localeCompare(b.dataset.docDate):b.dataset.docDate.localeCompare(a.dataset.docDate));
    const parent=folder.querySelector('.evrak-folder-items');for(const item of entries)parent.appendChild(item);
    let shown=0;entries.forEach(e=>{e.hidden=!!q&&!e.dataset.docName.includes(q);if(!e.hidden)shown++});
    folder.hidden=shown===0;if(q&&shown)folder.open=true;
  });
 }
 search.oninput=apply;sort.onchange=apply;
 document.getElementById('expandAllEvrak').onclick=()=>{const all=[...document.querySelectorAll('.evrak-folder:not([hidden])')];const open=all.some(x=>!x.open);all.forEach(x=>x.open=open)};
 apply();
}

async function renderCase(id){
  const [docs,finance,cases,syncStatus]=await Promise.all([
    api.uyapRemoteDocuments(id),
    api.accountingOverview(id),
    api.uyapCases(),
    api.uyapDocumentSyncStatus(id)
  ]);
  const file=cases.find(x=>String(x.id)===String(id))||{};
  const status=v=>({discovered:'İndirilecek',download_queued:'İndirme kuyruğunda',downloaded:'İndirildi',indexed:'İndekslendi',filed:'Arşivlendi',summarized:'Nota dönüştürüldü',duplicate:'Mükerrer',skipped:'Arşiv dışı',review:'İnceleme gerekli'}[String(v||'').toLowerCase()]||v||'Keşfedildi');

  const counts={};for(const d of docs){const cat=docCategory(d);counts[cat]=(counts[cat]||0)+1}
  const converted=(finance.converted||[]).map(x=>`<div class="notice-row accounting-row"><div><div class="doc-title">${esc(x.title)}</div><div class="doc-meta">${esc(extractLine(x.body,'Tarih'))} · ${esc(extractLine(x.body,'Tutar'))}</div><div class="accounting-source">${esc(extractLine(x.body,'Kaynak belge'))}</div></div>${badge('Nota dönüştürüldü','green')}</div>`).join('');
  const pending=(finance.pending||[]).map(x=>`<div class="notice-row accounting-row"><div><div class="doc-title">${esc(x.remote_title||x.document_type||x.original_file_name||'Mali evrak')}</div><div class="doc-meta">${esc(x.document_date||'Tarih yok')}</div><div class="accounting-source">${esc(x.reason||'İnceleme bekliyor')}</div></div>${badge('İnceleme bekliyor')}</div>`).join('');
  const financeBody=(converted||pending)?`<div class="case-finance-grid"><div>${section('Otomatik Notlar','₺',converted||empty('Bu dosyada otomatik mali not yok.'))}</div><div>${section('İnceleme Bekleyenler','!',pending||empty('Bu dosyada inceleme bekleyen mali evrak yok.'))}</div></div>`:empty('Bu dosyada tahsilat/reddiyat kaydı yok.');

  const lifecycleText={
    not_synced:'UYAP evrak listesi henüz sorgulanmadı.',
    queued:'Evrak listesi sorgusu kuyrukta bekliyor.',
    running:'UYAP’tan evrak listesi sorgulanıyor.',
    completed:'UYAP evrak listesi hazır.',
    empty:'UYAP sorgusu tamamlandı; bu dosyada evrak bulunamadı.',
    failed:'Evrak listesi sorgusu başarısız.',
    login_required:'UYAP oturumu gerekli.',
    metadata_unbound:'UYAP evrak metadata’sı döndü ancak BONO listesine işlenemedi.',
    unlinked:'Bu kayıt için UYAP dosya bağlantısı bulunamadı.'
  };
  const syncBusy=['queued','running'].includes(syncStatus.state);
  const syncMessage=syncStatus.error&&syncStatus.state==='failed'
    ?`${lifecycleText.failed} ${esc(syncStatus.error)}`
    :(syncStatus.label||lifecycleText[syncStatus.state]||'Evrak listesi durumu bilinmiyor.');
  const documentBody=docs.length?renderDocumentTree(docs,status):empty(lifecycleText[syncStatus.state]||syncMessage);
  const syncButtonLabel=syncStatus.state==='not_synced'
    ?"↻ UYAP'tan Evrak Listesini Getir"
    :(syncBusy?(syncStatus.state==='queued'?'Sorgu Bekliyor':'Sorgulanıyor…'):'↻ Evrak Listesini Yenile');
  const canSync=!!file.uyap_dosya_id&&!syncBusy&&syncStatus.state!=='login_required';

  const documentSummary=`<div class="case-document-summary" aria-label="Evrak durumları">
    <div><strong>${docs.length}</strong><span>UYAP evrak kaydı</span></div>
    <div><strong>${docs.filter(d=>!!d.local_asset_id).length}</strong><span>BONO'da</span></div>
    <div><strong>${docs.filter(d=>!d.local_asset_id).length}</strong><span>Henüz indirilmemiş</span></div>
  </div>`;
  const documentGuidance=`<div class="case-document-guidance">
    <div class="case-document-guidance-icon">▤</div>
    <div><strong>${docs.length?'Evrakları incelemeye hazır':'Evrak listesi boş'}</strong>
    <p>${docs.length?'Listeleme tamamlanmıştır anlamına gelmez; UYAP sorgusuyla yeni kayıtları kontrol edebilirsiniz.':esc(lifecycleText[syncStatus.state]||syncMessage)}</p></div>
  </div>`;
  const downloadControls=`<div class="case-download-controls">
    <div><strong>Evrak indirme</strong><p>Liste sorgusu evrak indirmez. Eksik evrak indirme işlemleri yalnız ayrıca onay verilerek ve UYAP motorunun güvenlik kontrollerinden geçerek başlayabilir.</p></div>
    <span class="case-download-pending">İndirme kontrolü · Entegrasyon bekleniyor</span>
  </div>`;

  const tabs=`<div class="case-tabs"><button class="case-tab active" data-file-tab="documents">Evraklar <span>${docs.length}</span></button><button class="case-tab" data-file-tab="finance">Tahsilat / Reddiyat <span>${(finance.counts?.converted||0)+(finance.counts?.pending||0)}</span></button></div>`;
  const related=(file.related_cases||[]).map(x=>`<a class="notice-row clickable" href="#uyap/${x.caseId}"><div><div class="doc-title">Bağlantılı Arabuluculuk Dosyası · ${esc(x.courtFileNo||'')}</div><div class="doc-meta">${esc(x.court||'')} · ${esc(x.caseType||'')} · ${esc(x.status||'')}</div></div><span>→</span></a>`).join('');

  mount(`<div class="case-header"><a class="back-link" href="#uyap">← Dosyalarıma dön</a><h1><span class="foy-badge ${file.office_file_no?'':'pending'}">${esc(file.office_file_no||'Föy Bekliyor')}</span>${esc(file.court||'Dosya')} ${file.court_file_no?'· '+esc(file.court_file_no):''}</h1><p class="detail-subtitle">${esc(file.case_type||'Dosya içeriği')}</p><div class="case-parties"><strong>Taraf Bilgileri</strong><div>${file.client_name?`<span><b>Müvekkil:</b> ${esc(file.client_name)}</span>`:''}${file.party_names?`<span><b>Kayıtlı taraflar:</b> ${esc(file.party_names)}</span>`:'<span>UYAP taraf bilgisi henüz kaydedilmemiş.</span>'}</div></div>${related?`<div class="related-case-list">${related}</div>`:''}</div>
    <div class="case-sync-panel ${docs.length?'has-documents':'is-empty'}"><div class="case-sync-copy"><strong>${docs.length?'Evrak listesini güncelle':'Bu dosyanın evrak listesi henüz alınmamış'}</strong><p>${docs.length?'Yeni evrak olup olmadığını UYAP üzerinden sorgulayabilirsin.':'UYAP üzerinden yalnız bu dosyanın evrak listesini sorgula. Bu işlem PDF/UDF dosyalarını indirmez.'}</p><small id="syncUyapStatus" role="status" aria-live="polite">${esc(syncMessage)}</small></div><button id="syncUyapDocs" type="button" class="primary-action" ${canSync?'':'disabled'}>${syncButtonLabel}</button></div>
    ${tabs}
    <div class="file-tab-panel" data-file-panel="documents">${documentSummary}${docs.length?'':documentGuidance}${section('Evraklar','▤',documentBody)}${downloadControls}</div>
    <div class="file-tab-panel" data-file-panel="finance" hidden>${financeBody}</div>`,'uyap');

  document.querySelectorAll('[data-file-tab]').forEach(b=>b.onclick=()=>{const tab=b.dataset.fileTab;document.querySelectorAll('[data-file-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('[data-file-panel]').forEach(p=>p.hidden=p.dataset.filePanel!==tab)});
  bindDocumentTree();

  document.querySelector('#syncUyapDocs:not(:disabled)')?.addEventListener('click',async e=>{
    const btn=e.currentTarget,notice=document.querySelector('#syncUyapStatus');
    btn.disabled=true;btn.textContent='Sorgu kuyruğa alınıyor…';notice.textContent='UYAP evrak listesi sorgusu gönderiliyor. Bu işlem PDF/UDF dosyalarını indirmez.';
    try{await api.syncUyapDocuments(id);await renderCase(id)}
    catch(err){notice.textContent='Sorgu başlatılamadı: '+err.message;btn.disabled=false;btn.textContent='↻ Tekrar Dene'}
  });

  if(syncBusy){
    setTimeout(()=>{
      if(location.hash===`#uyap/${id}`) renderCase(id).catch(()=>{});
    },750);
  }
}
