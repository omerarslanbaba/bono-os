import {mountUserQueries} from './user-queries.js';
import {queryOverview,partyText,openingDate,queryTime} from '../../case-query-state.mjs';
import {api} from '../../api.js';
import {inventoryState,inventoryTotals} from '../../inventory-state.mjs';
import {mount,pageHero,section,empty,esc,badge} from '../../ui.js';

function discoveryBar(s,a){
  const active=(s.queued||0)+(s.running||0);
  const d=a.discovery||{};
  const c=a.cbs||{};
  const cbsUnits=(c.units?.queued||0)+(c.units?.running||0);
  const cbsSearch=(c.search?.queued||0)+(c.search?.running||0);
  const state=active?'UYAP dosya listesi sorguları çalışıyor':'UYAP dosya keşfi durumu';
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
      <button id="syncAllUyap" class="primary-action" ${active?'disabled':''}>Tüm UYAP Dosya Listelerini Sorgula</button>
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
  return /kapalı|closed|archiv|kesinleş|tamamlan/.test(s)?'Kapalı':/açık|open|derdest/.test(s)?'Açık':'Bilinmiyor';
}
function options(values){return [...new Set(values.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'tr')).map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('')}
// Province selectors filter only locally recorded cases.
// UYAP-wide locality/authority discovery must be supplied by verified backend metadata.
const PROVINCES='Adana|Adıyaman|Afyonkarahisar|Ağrı|Aksaray|Amasya|Ankara|Antalya|Ardahan|Artvin|Aydın|Balıkesir|Bartın|Batman|Bayburt|Bilecik|Bingöl|Bitlis|Bolu|Burdur|Bursa|Çanakkale|Çankırı|Çorum|Denizli|Diyarbakır|Düzce|Edirne|Elazığ|Erzincan|Erzurum|Eskişehir|Gaziantep|Giresun|Gümüşhane|Hakkâri|Hatay|Iğdır|Isparta|İstanbul|İzmir|Kahramanmaraş|Karabük|Karaman|Kars|Kastamonu|Kayseri|Kırıkkale|Kırklareli|Kırşehir|Kilis|Kocaeli|Konya|Kütahya|Malatya|Manisa|Mardin|Mersin|Muğla|Muş|Nevşehir|Niğde|Ordu|Osmaniye|Rize|Sakarya|Samsun|Siirt|Sinop|Sivas|Şanlıurfa|Şırnak|Tekirdağ|Tokat|Trabzon|Tunceli|Uşak|Van|Yalova|Yozgat|Zonguldak'.split('|');
function caseProvince(r){
 const normalized=String(r.province||r.city||'').trim();
 if(normalized)return PROVINCES.find(p=>p.toLocaleLowerCase('tr-TR')===normalized.toLocaleLowerCase('tr-TR'))||'';
 const court=String(r.court||'').trim();
 return PROVINCES.find(p=>court.toLocaleLowerCase('tr-TR').startsWith(p.toLocaleLowerCase('tr-TR')+' '))||'';
}
function targetedSearchForm(o){
 const units=(o?.contractVersion==='uyap.case-search-options.v1'&&o.ready&&Array.isArray(o.units))?o.units:[];
 const items=units.map(x=>'<option value="'+esc(String(x.yargiTuru)+'|'+String(x.birimTuru2))+'">'+esc(x.label)+'</option>').join('');
 const disabled=units.length?'':'disabled';
 return `<div class="case-targeted-search">
   <div class="case-targeted-head"><div><strong>UYAP'ta Dosyayı Bul</strong><p>BONO'da bulunmayan, mahkemesi ve dosya numarası bilinen kayıtlar için gerçek UYAP araması.</p></div><span class="case-targeted-tag">Ayrı UYAP sorgusu</span></div>
   <div class="case-query-grid">
    <label>Yargı Birimi Türü<select id="remoteUnit" ${disabled}><option value="">Yargı birimi seçin</option>${items}</select></label>
    <label>Dosya Durumu<select id="remoteStatus" ${disabled}><option value="0">Açık</option><option value="1">Kapalı</option></select></label>
    <label>Mahkeme / Başsavcılık<input id="remoteCourt" placeholder="Örn. Eskişehir Cumhuriyet Başsavcılığı" ${disabled}></label>
    <label>Dosya Yılı / Dosya Numarası<div class="case-year-row"><input id="remoteYear" inputmode="numeric" placeholder="Yıl" ${disabled}><input id="remoteBaseNo" inputmode="numeric" placeholder="Esas / soruşturma no" ${disabled}></div></label>
   </div>
   <div class="case-targeted-actions"><small id="remoteSearchState" role="status" aria-live="polite">${units.length?'UYAP arama parametreleri doğrulandı. Bu işlem PDF/UDF indirmez.':'UYAP arama hizmeti henüz kullanılamıyor veya yargı birimi gözlemi eksik.'}</small><button type="button" id="remoteSearchButton" class="primary-action" ${disabled}>⌕ UYAP'ta Dosyayı Bul</button></div>
   <p class="case-targeted-notice"><strong>Soruşturma numarasını bilmiyor musun?</strong> Bu hedefli arama numara gerektirir. Önce genel CBS dosya keşfi tamamlanmalı veya soruşturma numarası UYAP Avukat Portal'dan öğrenilmelidir. Bu alan tüm CBS soruşturmalarını isme göre taramaz.</p>
  </div>`;
}
function bindTargetedCaseSearch(){
 const button=document.getElementById('remoteSearchButton'),note=document.getElementById('remoteSearchState');
 if(!button||!note||button.disabled)return;
 let stopped=false,timeoutId=null;
 const stop=()=>{stopped=true;if(timeoutId)clearTimeout(timeoutId)};
 window.addEventListener('hashchange',stop,{once:true});
 async function poll(searchId){
   if(stopped||location.hash!=='#uyap'||!note.isConnected)return;
   try{
     const r=await api.uyapCaseSearchStatus(searchId);
     if(stopped||!note.isConnected)return;
     note.textContent=r.label||r.state||'Sorgu durumu okunuyor';
     if(r.state==='completed'&&r.match?.caseId){
       const id=Number(r.match.caseId);
       if(Number.isSafeInteger(id)&&id>0){
         const a=document.createElement('a');a.href='#uyap/'+id;
         a.textContent=String(r.match.court||'UYAP dosyası')+' · '+String(r.match.fileNo||'');
         note.textContent='Dosya bulundu: ';note.appendChild(a);
       }
     }
     if(r.terminal===true||r.state==='login_required'){
       button.disabled=false;return;
     }
     timeoutId=setTimeout(()=>poll(searchId),Math.max(1000,Math.min(15000,Number(r.pollAfterMs)||2500)));
   }catch(e){note.textContent='Dosya araması izlenemedi: '+e.message;button.disabled=false}
 }
 button.onclick=async()=>{
   const u=String(document.getElementById('remoteUnit').value||'').split('|');
   const court=String(document.getElementById('remoteCourt').value||'').trim();
   const year=Number(document.getElementById('remoteYear').value);
   const baseNumber=Number(document.getElementById('remoteBaseNo').value);
   const yargiTuru=Number(u[0]),birimTuru2=u[1];
   if(!u[0]||!birimTuru2||!court||!Number.isInteger(year)||year<1900||year>2200||!Number.isInteger(baseNumber)||baseNumber<1){
     note.textContent='Gerçek UYAP araması için birim türü, mahkeme/başsavcılık, yıl ve dosya numarası zorunludur.';return;
   }
   button.disabled=true;note.textContent='Dosya sorgusu kuyruğa alınıyor. Evrak indirilmez.';
   try{
     const result=await api.searchUyapCase({yargiTuru,birimTuru2,court,year,baseNumber,dosyaDurumKod:Number(document.getElementById('remoteStatus').value)});
     if(result?.accepted!==true||!result.searchId)throw new Error('UYAP arama kimliği alınamadı');
     await poll(result.searchId);
   }catch(e){note.textContent='Arama başlatılamadı: '+e.message;button.disabled=false}
 };
}
function queryForm(rows){
  const years=rows.map(r=>String(r.court_file_no||'').match(/(20\d{2})\//)?.[1]);
  return `<div class="case-query"><div class="case-query-grid">
  <label>Yargı Türü<select id="filterType"><option value="">Tümü</option>${JUDGMENT_TYPES.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('')}</select></label>
  <label>Dosya Durumu<div class="case-state-toggle" role="group" aria-label="Dosya Durumu"><button type="button" class="state-option active" data-state="Açık">Açık</button><button type="button" class="state-option" data-state="Kapalı">Kapalı</button></div></label>
  <label>İl<select id="filterProvince"><option value="">Tümü</option>${options(rows.map(caseProvince))}</select></label>\n  <label>Yargı Birimi<select id="filterUnit"><option value="">Tümü</option></select></label>
  <label>Dosya Yıl / No<div class="case-year-row"><select id="filterYear"><option value="">Tümü</option>${options(years)}</select><input id="filterNo" placeholder="Dosya No"></div></label>
  <label>Mahkeme<select id="filterCourt"><option value="">Tümü</option></select></label>
  <label>Dosyada Ara<input id="filterQuery" placeholder="Föy no, mahkeme, esas no, müvekkil veya taraf"></label>
  </div><p class="case-query-local-note">Bu filtreler yalnızca BONO'da kayıtlı dosyaları gösterir. Gerçek UYAP sorgusu yalnız dosya detayındaki ayrı işlemle başlatılır.</p><div class="case-query-actions"><span id="filterCount"></span><button id="resetFilters" type="button" class="subtle-action">Temizle</button><button id="applyFilters" type="button" class="primary-action">Filtreleri uygula</button></div></div>`;
}
function bindQuery(rows){
 const by=id=>document.getElementById(id),t=by('filterType'),u=by('filterUnit'),c=by('filterCourt'),province=by('filterProvince');
 let selectedState='Açık',sortKey=0,ascending=true;
 const values=r=>[r.court||'',r.court_file_no||'',r.case_type||'',statusText(r),openingDate(r),partyText(r)];
 function set(el,vals){const old=el.value;el.innerHTML='<option value="">Tümü</option>'+options(vals);el.value=vals.includes(old)?old:''}
 function courts(){set(c,rows.filter(r=>(!t.value||rootType(r)===t.value)&&(!u.value||unit(r)===u.value)&&(!province.value||caseProvince(r)===province.value)).map(r=>r.court));apply()}
 function units(){set(u,[...new Set(rows.filter(r=>(!t.value||rootType(r)===t.value)&&(!province.value||caseProvince(r)===province.value)).map(unit).filter(Boolean))]);courts()}
 function apply(){
   const accepted=new Set(rows.filter(r=>{
    const number=String(r.court_file_no||''),match=number.match(/(\d{4})\s*\/\s*(\d+)/),columnValues=values(r);
    return (!t.value||rootType(r)===t.value)&&(!u.value||unit(r)===u.value)&&(!c.value||r.court===c.value)&&(!province.value||caseProvince(r)===province.value)&&(statusText(r)===selectedState)&&(!by('filterYear').value||match?.[1]===by('filterYear').value)&&(!by('filterNo').value||String(match?.[2]||'').includes(by('filterNo').value.trim()))&&(!by('filterQuery').value||String([r.office_file_no,...columnValues].join(' ')).toLocaleLowerCase('tr-TR').includes(by('filterQuery').value.toLocaleLowerCase('tr-TR').trim()))&&[...document.querySelectorAll('[data-column-filter]')].every(input=>columnValues[Number(input.dataset.columnFilter)].toLocaleLowerCase('tr-TR').includes(input.value.toLocaleLowerCase('tr-TR').trim()));
   }).map(x=>String(x.id)));
   const ordered=rows.slice().sort((a,b)=>String(values(a)[sortKey]).localeCompare(String(values(b)[sortKey]),'tr',{numeric:true})*(ascending?1:-1));
   for(const r of ordered){const el=by('case-row-'+r.id);if(el){el.hidden=!accepted.has(String(r.id));by('caseTableBody').append(el)}}
   by('filterCount').textContent=accepted.size+' / '+rows.length+' dosya listeleniyor.';by('noCaseMatches').hidden=accepted.size>0;
 }
 document.querySelectorAll('.state-option').forEach(b=>b.onclick=()=>{selectedState=b.dataset.state;document.querySelectorAll('.state-option').forEach(x=>x.classList.toggle('active',x===b));apply()});
 t.onchange=units;u.onchange=courts;province.onchange=units;c.onchange=apply;by('filterYear').onchange=apply;by('applyFilters').onclick=apply;
 by('resetFilters').onclick=()=>{document.querySelectorAll('.case-query input,.case-query select,[data-column-filter]').forEach(e=>e.value='');selectedState='Açık';document.querySelectorAll('.state-option').forEach(x=>x.classList.toggle('active',x.dataset.state==='Açık'));units()};
 by('filterQuery').oninput=apply;by('filterNo').oninput=apply;
 document.querySelectorAll('[data-column-filter]').forEach(input=>input.oninput=apply);
 document.querySelectorAll('[data-case-sort]').forEach(button=>button.onclick=()=>{const key=Number(button.dataset.caseSort);ascending=sortKey===key?!ascending:true;sortKey=key;document.querySelectorAll('[data-case-sort]').forEach(x=>x.closest('th').setAttribute('aria-sort',x===button?(ascending?'ascending':'descending'):'none'));apply()});
 document.querySelectorAll('.case-list-row').forEach(row=>{row.onclick=e=>{if(!e.target.closest('a,button,input'))location.hash='#uyap/'+row.dataset.caseId};row.onkeydown=e=>{if(e.key==='Enter'&&e.target===row)location.hash='#uyap/'+row.dataset.caseId}});
 units();
}

export async function renderUyap(id){
  if(id)return renderCase(id);
  const rows=await api.uyapCases();
  const inv=inventoryTotals(rows);
  const columns=['Birim','Dosya No','Dosya Türü','Dosya Durumu','Dosya Açılış Tarihi','Taraf Bilgileri'];
  const body=`<div class="case-list-scroll case-table-scroll"><table class="case-results-table"><thead><tr>${columns.map((name,i)=>`<th scope="col" aria-sort="none"><button type="button" data-case-sort="${i}">${name} ↕</button></th>`).join('')}<th scope="col">Dosyayı Görüntüle</th></tr><tr>${columns.map((name,i)=>`<th><input data-column-filter="${i}" aria-label="${name} sütununda filtrele" placeholder="Filtrele"></th>`).join('')}<th></th></tr></thead><tbody id="caseTableBody">${rows.map(r=>`<tr id="case-row-${Number(r.id)}" class="case-list-row" data-case-id="${Number(r.id)}" tabindex="0" aria-label="${esc(r.court||'Dosya')} ${esc(r.court_file_no||'')}"><td>${esc(r.court||'—')}</td><td>${esc(r.court_file_no||'—')}</td><td>${esc(r.case_type||'—')}</td><td>${esc(statusText(r))}</td><td>${esc(openingDate(r)||'—')}</td><td>${esc(partyText(r))}</td><td><a href="#uyap/${Number(r.id)}">Görüntüle →</a></td></tr>`).join('')}</tbody></table></div><p id="noCaseMatches" hidden>Bu filtrelerle eşleşen kayıt yok.</p>`;
  const inventorySummary=`<p class="inventory-totals">${inv.known} kayıtlı dosya · ${inv.never} hiç sorgulanmadı · ${inv.partial} kısmi liste · ${inv.unknown} kapsamı bilinmiyor</p>`;
  mount(pageHero('Dosyalarım','Kayıtlı dosyalarını bul ve görüntüle.')+
    inventorySummary+queryForm(rows)+'<p>Yeni UYAP sorguları yalnız doğrulanmış dosya içindeki Sorgula/Yenile işlemiyle başlatılır. Geniş discovery kapalıdır.</p>'+section('Dosya Sorgulama Sonuçları','⚖',body),'uyap');
  bindQuery(rows);
  bindTargetedCaseSearch();
  // Sorgulama filtreleri bindQuery tarafından yönetilir.
  document.querySelector('#syncAllUyap')?.addEventListener('click',async e=>{
    if(!confirm('UYAP dosya listelerinin (CBS dahil) sorgusu başlatılsın mı? Bu işlem evrak indirmez ve indirme duraklatmasını kaldırmaz.'))return;
    e.currentTarget.disabled=true;e.currentTarget.textContent='UYAP dosya keşfi kuyruğa alınıyor…';
    try{
      await api.startUyapDiscovery({statuses:[0,1],syncDocuments:false});
      e.currentTarget.textContent='Dosya listesi sorgusu kuyruğa alındı';
    }catch(err){alert(err.message);e.currentTarget.disabled=false}
  });
}

function renderDocumentTree(docs,status){
 const folders=new Map();
 for(const doc of docs){const name=String(doc.document_type||doc.remote_title||'Diğer Evrak');if(!folders.has(name))folders.set(name,[]);folders.get(name).push(doc)}
 const ordered=[...folders.entries()].sort((a,b)=>a[0].localeCompare(b[0],'tr'));
 const groups=ordered.map(([name,items],i)=>`<details class="evrak-folder" ${i===0?'open':''}><summary>▱　${esc(name)} (${items.length})</summary><div class="evrak-folder-items">${items.map(x=>`<button type="button" class="evrak-entry clickable-document case-document-open" data-remote-document-id="${esc(x.id)}" data-doc-name="${esc(String([name,x.remote_title,x.original_file_name].join(' ')).toLocaleLowerCase('tr-TR'))}" data-doc-date="${esc(x.document_date||'')}"><div><strong>${esc(x.remote_title||x.original_file_name||name)}</strong><small>${esc(x.document_date||'')} · ${esc(status(x.status))}</small></div>${x.local_asset_id?badge('Detay','green'):badge('Durumu gör')}</button>`).join('')}</div></details>`).join('');
 return `<div class="evrak-tree-tools"><input id="evrakSearch" placeholder="Evrakta ara" aria-label="Evrakta ara"><button id="expandAllEvrak" class="subtle-action" type="button" title="Tüm klasörleri aç / kapat">▤</button><select id="evrakSort" aria-label="Sıralama"><option value="new">Yeni → Eski</option><option value="old">Eski → Yeni</option><option value="name">Adına göre</option></select></div><div class="evrak-tree"><div class="evrak-tree-root">▾　▱ Dosya Evrakları (${docs.length})</div>${groups}</div>`;
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

async function renderCase(id,feedback=''){
  const [docs,finance,cases,queryRead]=await Promise.all([api.uyapRemoteDocuments(id),api.accountingOverview(id),api.uyapCases(),fetch('/api/uyap/cases/'+encodeURIComponent(id)+'/query-history').then(async r=>{if(!r.ok)throw Error('HTTP '+r.status);return {rows:await r.json()}}).catch(e=>({rows:[],error:e.message}))]);
  const file=cases.find(x=>String(x.id)===String(id))||{};
  const inventory=inventoryState(file,docs);
  const overview=queryOverview(queryRead.rows,docs.length);
  const status=v=>({discovered:'İndirilecek',download_queued:'İndirme kuyruğunda',downloaded:'İndirildi',indexed:'İndekslendi',filed:'Arşivlendi',summarized:'Nota dönüştürüldü',duplicate:'Mükerrer',skipped:'Arşiv dışı',review:'İnceleme gerekli'}[String(v||'').toLowerCase()]||v||'Keşfedildi');

  const counts={};for(const d of docs){const c=docCategory(d);counts[c]=(counts[c]||0)+1}
  const cats=['Tümü',...Object.keys(counts).sort((a,b)=>a.localeCompare(b,'tr'))];
  const filters=`<div class="document-categories">${cats.map((c,i)=>`<button class="category-chip ${i===0?'active':''}" data-cat="${esc(c)}">${esc(c)} <span>${c==='Tümü'?docs.length:counts[c]}</span></button>`).join('')}</div>`;
  const docRows=docs.length?`<div class="evrak-scroll">${docs.map(d=>{const cat=docCategory(d);return `<div class="notice-row evrak-row" data-category="${esc(cat)}"><div><div class="doc-title">${esc(d.remote_title||d.document_type||'UYAP Evrakı')}</div><div class="doc-meta">${esc(d.document_date||'')} · ${esc(cat)} · ${esc(status(d.status))}</div></div><div class="row-actions">${d.status==='summarized'?badge('Nota dönüştürüldü','green'):(d.local_asset_id?badge('BONO’da','green'):badge(d.status==='download_queued'?'Bekliyor':'Henüz alınmadı'))}</div></div>`}).join('')}</div>`:empty('Evrak listesi henüz alınmadı.');

  const converted=(finance.converted||[]).map(x=>`<div class="notice-row accounting-row"><div><div class="doc-title">${esc(x.title)}</div><div class="doc-meta">${esc(extractLine(x.body,'Tarih'))} · ${esc(extractLine(x.body,'Tutar'))}</div><div class="accounting-source">${esc(extractLine(x.body,'Kaynak belge'))}</div></div>${badge('Nota dönüştürüldü','green')}</div>`).join('');
  const pending=(finance.pending||[]).map(x=>`<div class="notice-row accounting-row"><div><div class="doc-title">${esc(x.remote_title||x.document_type||x.original_file_name||'Mali evrak')}</div><div class="doc-meta">${esc(x.document_date||'Tarih yok')}</div><div class="accounting-source">${esc(x.reason||'İnceleme bekliyor')}</div></div>${badge('İnceleme bekliyor')}</div>`).join('');
  const financeBody=(converted||pending)?`<div class="case-finance-grid"><div>${section('Otomatik Notlar','₺',converted||empty('Bu dosyada otomatik mali not yok.'))}</div><div>${section('İnceleme Bekleyenler','!',pending||empty('Bu dosyada inceleme bekleyen mali evrak yok.'))}</div></div>`:empty('Bu dosyada tahsilat/reddiyat kaydı yok.');

  const downloadControls=`<div class="case-download-controls">
    <div><strong>Evrak indirme</strong><p>Liste sorgusu evrak indirmez. Eksik evrak indirme işlemleri yalnız ayrıca onay verilerek ve UYAP motorunun güvenlik kontrollerinden geçerek başlayabilir.</p></div>
    <div class="case-download-actions"><small id="caseDownloadStatus" role="status" aria-live="polite">İndirme durumu kontrol ediliyor…</small><button id="queueCaseDownloads" type="button" class="subtle-action" disabled>Eksik Evrakları Kuyruğa Ekle</button></div>
  </div>`;

  const tabs=`<div class="case-tabs"><button class="case-tab active" data-file-tab="documents">Evraklar <span>${docs.length}</span></button><button class="case-tab" data-file-tab="finance">Tahsilat / Reddiyat <span>${(finance.counts?.converted||0)+(finance.counts?.pending||0)}</span></button></div>`;
  const related=(file.related_cases||[]).map(x=>`<a class="notice-row clickable" href="#uyap/${x.caseId}"><div><div class="doc-title">Bağlantılı Arabuluculuk Dosyası · ${esc(x.courtFileNo||'')}</div><div class="doc-meta">${esc(x.court||'')} · ${esc(x.caseType||'')} · ${esc(x.status||'')}</div></div><span>→</span></a>`).join('');

  const inventoryPanel=`<details class="case-technical"><summary>Teknik Ayrıntılar</summary><p>UYAP kimliği: ${esc(inventory.identity)}. Kimliğin kayıtlı olması canlı doğrulama değildir.</p><p>İndirme: ${esc(inventory.download)} · Bütünlük: ${esc(inventory.integrity)}</p><p>Evrak aidiyeti ve hash kontrolleri korunur. Bir CBS liste sorgusu evrak aidiyetini doğrulamaz.</p><div id="queryTechnicalDetails"></div><details><summary>Sorgu geçmişi</summary><div id="caseQueryHistory"></div></details></details>`;
  mount(`<div class="case-header"><a class="back-link" href="#uyap">← Dosyalarıma dön</a><h1><span class="foy-badge ${file.office_file_no?'':'pending'}">${esc(file.office_file_no||'Föy Bekliyor')}</span>${esc(file.court||'Dosya')} ${file.court_file_no?'· '+esc(file.court_file_no):''}</h1><p class="detail-subtitle">${esc(file.case_type||'Dosya içeriği')}</p><div class="case-parties"><strong>Taraf Bilgileri</strong><div>${file.client_name?`<span><b>Müvekkil:</b> ${esc(file.client_name)}</span>`:''}${file.party_names?`<span><b>Kayıtlı taraflar:</b> ${esc(file.party_names)}</span>`:'<span>UYAP taraf bilgisi henüz kaydedilmemiş.</span>'}</div></div>${related?`<div class="related-case-list">${related}</div>`:''}</div>
    <div class="case-query-overview"><p id="lastQuerySummary">Son UYAP sorgusu: ${esc(queryRead.error?'Durum okunamadı: '+queryRead.error:overview.label)}${overview.success?' · Son başarılı: '+esc(queryTime(overview.success.occurred_at||overview.success.created_at)):''}</p><p id="documentListSummary">${esc(overview.documents)}</p>${feedback?`<p class="query-feedback" role="status">${esc(feedback)}</p>`:''}</div>
    <div class="case-sync-panel ${docs.length?'has-documents':'is-empty'}"><div class="case-sync-copy"><strong>UYAP'ta Sorgula</strong><p>Yalnız bu dosya için kullanıcı kontrollü, salt-okunur sorgu. Fiziksel evrak indirme ayrı onaydır.</p><small id="syncUyapStatus" role="status" aria-live="polite">${file.uyap_dosya_id?'Sorgu desteği kontrol ediliyor.':'Bu kayıt için doğrulanmış UYAP dosya bağlantısı bulunamadı.'}</small></div><button id="syncUyapDocs" type="button" class="primary-action" disabled>UYAP'ta Sorgula</button></div>
    <div id="case-documents"></div>${tabs}
    <div class="file-tab-panel" data-file-panel="documents">${docs.length?section('Evraklar','▤',renderDocumentTree(docs,status)):''}<div id="caseDocumentViewer" class="case-document-viewer" hidden aria-live="polite"></div>${downloadControls}</div>${inventoryPanel}
    <div class="file-tab-panel" data-file-panel="finance" hidden>${financeBody}</div>`,'uyap');

  document.querySelectorAll('[data-file-tab]').forEach(b=>b.onclick=()=>{const tab=b.dataset.fileTab;document.querySelectorAll('[data-file-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('[data-file-panel]').forEach(p=>p.hidden=p.dataset.filePanel!==tab)});
  bindDocumentTree();
  mountUserQueries(id,message=>renderCase(id,message),{documentCount:docs.length});
  bindCaseDocumentViewer(id);
}


let activeCaseLifecycle=null;
function bindCaseDocumentControls(caseId){
  if(activeCaseLifecycle)activeCaseLifecycle.stop();
  const btn=document.getElementById('syncUyapDocs'),notice=document.getElementById('syncUyapStatus');
  const downloadButton=document.getElementById('queueCaseDownloads'),downloadNotice=document.getElementById('caseDownloadStatus');
  const route='#uyap/'+caseId;
  let timer=null,stopped=false,busy=false,startedCommandId=null,completedHandled=false;
  let statusSupported=false,downloadCapacity=0;
  // A document.list command may be completed by Chat-UYAP outside this page.
  // Reconcile with BONO's persisted remote-document count without starting another request.
  let knownVisibleRemoteCount=Number(document.querySelector('.case-document-summary strong')?.textContent||0);
  const labels={not_synced:'Evrak listesi henüz sorgulanmamış',queued:'Sorgu sırada bekliyor',running:'UYAP evrak listesi sorgulanıyor',completed:'Evrak listesi hazır',empty:'Sorgu tamamlandı: evrak bulunamadı',failed:'Sorgu başarısız',login_required:'UYAP oturumu gerekli',metadata_unbound:'Evrak bilgileri geldi ancak BONO listesine işlenemedi',unlinked:'Bu kaydın UYAP dosya bağlantısı yok'};
  const stop=()=>{stopped=true;if(timer)clearTimeout(timer)};
  const session={stop};activeCaseLifecycle=session;
  const alive=()=>!stopped&&activeCaseLifecycle===session&&location.hash===route&&!!notice?.isConnected;
  function schedule(ms){if(timer)clearTimeout(timer);if(!stopped)timer=setTimeout(poll,ms)}
  async function refreshDownloadState(){
    if(!alive()||!statusSupported||!downloadButton)return;
    try{
      const d=await api.uyapDownloadSummary(caseId);if(!alive())return;
      const missing=Math.max(0,Number(d.missingDownloadable??0));
      const active=Math.max(0,Number(d.activeCommands??0));
      const reportedCapacity=Number(d.capacity);
      if(!Number.isFinite(reportedCapacity)||reportedCapacity<0)throw new Error('Core indirme kapasitesi bilinmiyor');
      downloadCapacity=Math.max(0,Math.min(200,Math.floor(reportedCapacity),missing));
      downloadButton.disabled=downloadCapacity===0;
      downloadButton.textContent=downloadCapacity?'Eksik Evrakları Kuyruğa Ekle ('+downloadCapacity+')':'İndirilecek evrak yok / kapasite dolu';
      downloadNotice.textContent='Eksik: '+missing+' · Aktif: '+active+' · Kapasite: '+Math.floor(reportedCapacity)+(d.manualDownloadPaused?' · İndirmeler manuel duraklatılmış':'')+' · İndirme ayrıca onay gerektirir';
    }catch{if(alive()){downloadButton.disabled=true;downloadNotice.textContent='İndirme durumu okunamadı; işlem devre dışı';}}
  }
  async function poll(){
    if(!alive()||busy)return;
    busy=true;
    try{
      const x=await api.uyapDocumentSyncStatus(caseId);
      if(!alive())return;
      statusSupported=true;
      if(x.contractVersion!=='uyap.document-sync.v1')throw new Error('UYAP sorgu durum API sürümü desteklenmiyor');
      const state=x.state||'not_synced',pending=state==='queued'||state==='running';
      const commandId=x.command?.id??null;
      notice.textContent=(labels[state]||x.label||state)+(commandId?' · Komut #'+commandId:'')+(x.error&&state==='failed'?' · '+x.error:'');
      if(btn){btn.disabled=!x.canSync;btn.textContent=pending?'Sorgu devam ediyor…':'↻ UYAP\'tan Evrak Listesini Getir'}
      await refreshDownloadState();
      const serverRemoteCount=x.documents?.remoteCount==null?NaN:Number(x.documents.remoteCount);
      if((state==='completed'||state==='empty')&&x.terminal===true&&x.success===true&&
         Number.isSafeInteger(serverRemoteCount)&&serverRemoteCount>=0&&
         serverRemoteCount!==knownVisibleRemoteCount){
        knownVisibleRemoteCount=serverRemoteCount;
        stop();
        await renderCase(caseId);
        return;
      }
      if(startedCommandId!=null&&String(commandId)===String(startedCommandId)&&x.terminal&&!completedHandled){
        completedHandled=true;
        if(x.success&&(state==='completed'||state==='empty')){
          // Only refresh this case after the matching command reached a confirmed terminal state.
          stop();
          await renderCase(caseId);
          return;
        }
      }
      schedule(pending?Math.max(1000,Math.min(15000,Number(x.pollAfterMs)||2500)):10000);
    }catch(err){
      if(alive()){
        statusSupported=false;
        notice.textContent='Sorgu durumu şu an görüntülenemiyor: '+err.message+'. Güncel BONO Core gerekli.';
        if(btn){btn.disabled=true;btn.textContent='Sorgu entegrasyonu bekleniyor'}
        if(downloadButton)downloadButton.disabled=true;
        if(downloadNotice)downloadNotice.textContent='Güvenli indirme için güncel Core gerekli';
        schedule(15000);
      }
    }finally{busy=false}
  }
  btn?.addEventListener('click',async ()=>{
    if(!alive()||btn.disabled||!statusSupported)return;
    btn.disabled=true;notice.textContent='Yalnızca bu dosyanın evrak listesi için komut gönderiliyor…';
    try{
      const result=await api.syncUyapDocuments(caseId);
      if(result?.accepted!==true||!result.commandId)throw new Error('Core sorgu komutunu onaylamadı veya komut kimliği vermedi.');
      startedCommandId=result.commandId;completedHandled=false;
      notice.textContent='Sorgu kuyruğa alındı'+(startedCommandId?' · Komut #'+startedCommandId:'');
      await poll();
    }catch(err){if(alive()){notice.textContent='Sorgu başlatılamadı: '+err.message;btn.disabled=false;}}
  });
  downloadButton?.addEventListener('click',async ()=>{
    if(!alive()||downloadButton.disabled||!statusSupported||downloadCapacity<1)return;
    const count=downloadCapacity;
    if(!confirm('Bu dava dosyası için en fazla '+count+' eksik evrak indirme kuyruğuna eklensin mi? Manuel duraklatma açıksa indirmeler başlamaz.'))return;
    downloadButton.disabled=true;downloadNotice.textContent='Onaylanan indirme komutları kuyruğa ekleniyor…';
    try{
      await api.queueMissingUyapDocuments(caseId,count);
      if(alive()){downloadNotice.textContent='İndirme kuyruğuna ekleme isteği gönderildi. Manuel duraklatma değiştirilmedi.';await refreshDownloadState();}
    }catch(err){if(alive()){downloadNotice.textContent='İndirme kuyruğu hatası: '+err.message;await refreshDownloadState();}}
  });
  poll();
}

function bindCaseDocumentViewer(caseId){
  const panel=document.getElementById('caseDocumentViewer');
  const entries=document.querySelectorAll('.case-document-open');
  let seq=0;
  for(const button of entries)button.addEventListener('click',async()=>{
    const docId=Number(button.dataset.remoteDocumentId);
    if(!Number.isSafeInteger(docId)||docId<1||!panel)return;
    const current=++seq;
    panel.hidden=false;
    panel.textContent='Evrak bilgileri doğrulanıyor…';
    try{
      const response=await api.caseDocumentView(caseId,docId);
      if(current!==seq||!panel.isConnected||location.hash!=='#uyap/'+caseId)return;
      if(response?.ok!==true||Number(response.document?.caseId)!==Number(caseId)||Number(response.document?.remoteDocumentDbId)!==docId)throw new Error('Evrakın dava dosyasına bağlı olduğu doğrulanamadı');
      const d=response.document,download=d.download||{},integrity=d.integrity||{},readability=d.readability||{},viewer=d.viewer||{};
      const plainStatus=(v)=>v?'Evet':'Hayır';
      const label=(text,value)=>'<div><span>'+esc(text)+'</span><strong>'+esc(value)+'</strong></div>';
      const canOpen=viewer.openable===true&&integrity.verified===true&&integrity.exists===true;
      const contentUrl=api.caseDocumentContentUrl(caseId,docId);
      const opened=canOpen?(viewer.mode==='pdf_inline'?'<iframe title="Doğrulanmış PDF evrakı" class="case-document-pdf" src="'+contentUrl+'"></iframe>':viewer.mode==='udf_text'?'<a class="subtle-action" href="'+contentUrl+'" download>Doğrulanmış UDF aslını indir ↓</a>':('<a class="subtle-action" href="'+contentUrl+'" target="_blank" rel="noopener">Doğrulanmış evrakı aç / indir ↗</a>')):'<div class="case-document-warning">Dosyanın bütünlüğü doğrulanmadan fiziksel içerik açılmaz.</div>';
      const body=readability.readable===true&&typeof readability.text==='string'?'<details class="case-document-text" open><summary>Çıkarılmış belge metni</summary><pre>'+esc(readability.text)+'</pre></details>':'<div class="case-document-warning">Metin okunamıyor veya henüz çıkarılmamış. '+esc(readability.error||readability.status||'')+'</div>';
      panel.innerHTML='<div class="case-document-viewer-head"><div><small>EVRAK İNCELEME</small><h3>'+esc(d.name||'UYAP Evrakı')+'</h3><p>'+esc(d.documentType||'Evrak')+' · '+esc(d.documentDate||'Tarih bilinmiyor')+'</p></div><button id="closeCaseDocumentViewer" class="subtle-action" type="button">Kapat ×</button></div><div class="case-document-flags">'+label('İndirilmiş',plainStatus(download.downloaded===true))+label('SHA doğrulandı',plainStatus(integrity.verified===true))+label('Metin okunabilir',plainStatus(readability.readable===true))+label('Görüntüleme',viewer.mode||'Kullanılamıyor')+'</div>'+opened+body;
      panel.querySelector('#closeCaseDocumentViewer')?.addEventListener('click',()=>{seq++;panel.hidden=true;panel.textContent=''});
      panel.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(err){
      if(current!==seq||!panel.isConnected)return;
      panel.textContent='Evrak görüntüleme servisine ulaşılamadı: '+err.message+'. Güncel Core entegrasyonu gerekebilir.';
    }
  });
}
