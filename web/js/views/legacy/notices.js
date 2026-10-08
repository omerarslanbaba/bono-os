import {api} from '../api.js';
import {mount,pageHero,section,empty,esc,badge} from '../ui.js';

const typeLabel={physical:'Fiziksel',electronic:'E-Tebliğ'};
const stateLabel={pending:'Bekliyor',in_transit:'PTT Sürecinde',delivered:'Teslim',returned:'İade',provider_error:'PTT Hatası',needs_review:'Kontrol',receipt_received:'Mazbata Geldi'};
const stateClass={delivered:'green',receipt_received:'green',returned:'red',provider_error:'red',needs_review:'red',in_transit:'blue',pending:''};

function fmt(v){return v?String(v).replace('T',' ').slice(0,16):'—'}
function row(x){
 const file=x.file_no||[x.court,x.court_file_no].filter(Boolean).join(' ')||'—';
 const legal=x.legal_service_date
   ? (x.legal_service_date_approved?fmt(x.legal_service_date):'Taslak · onay bekliyor')
   : 'Belirlenmedi';
 return `<div class="notice-table-row" data-status="${esc(x.status)}">
   <div>${x.office_file_id?`<a class="table-link" href="#cases/${x.office_file_id}">${esc(file)}</a>`:`<strong>${esc(file)}</strong>`}<small>${esc(x.court||'')}</small></div>
   <div><strong>${esc(x.recipient||'Muhatap okunmadı')}</strong><small>${esc(typeLabel[x.service_type]||x.service_type||'')}</small></div>
   <div class="mono notice-barcode">${esc(x.barcode||'Barkod yok')}</div>
   <div>${fmt(x.dispatch_at)}</div>
   <div>${fmt(x.delivered_at)}</div>
   <div><strong>${esc(x.ptt_status||stateLabel[x.status]||x.status)}</strong><small>${x.last_checked_at?'Son kontrol '+esc(fmt(x.last_checked_at)):'Henüz sorgulanmadı'}</small></div>
   <div>${x.uyap_receipt_at?badge('Mazbata geldi','green'):badge('Bekleniyor')}</div>
   <div><strong>${esc(legal)}</strong><small>${x.legal_service_date_approved?'Avukat onaylı':'Otomatik kesinleştirilmez'}</small></div>
 </div>`;
}

export async function renderNotices(){
 const [rows,provider]=await Promise.all([api.shipments(),api.providerStatus()]);
 const counts={
   all:rows.length,
   waiting:rows.filter(x=>['pending','in_transit','provider_error','needs_review'].includes(x.status)).length,
   delivered:rows.filter(x=>x.status==='delivered').length,
   receipt:rows.filter(x=>x.status==='receipt_received').length
 };
 const filters=`<div class="filter-pills">
   <button class="active" data-nfilter="all">Tümü <b>${counts.all}</b></button>
   <button data-nfilter="waiting">Takipte <b>${counts.waiting}</b></button>
   <button data-nfilter="delivered">Teslim <b>${counts.delivered}</b></button>
   <button data-nfilter="receipt">Mazbata <b>${counts.receipt}</b></button>
 </div>`;
 const providerBox=`<div class="provider-note">
   <div><strong>PTT sağlayıcısı</strong><span>${provider.ptt?.automatic?'Otomatik':'Adapter hazır · canlı sorgu henüz bağlı değil'}</span></div>
   <div><strong>Hukuki etki</strong><span>PTT operasyonel veridir. Tebliğ tarihi BONO tarafından kendiliğinden kesinleştirilmez.</span></div>
 </div>`;
 const header=`<div class="notice-table-head"><span>Föy</span><span>Muhatap / Tür</span><span>Barkod</span><span>Çıkış</span><span>Teslim</span><span>PTT Durumu</span><span>UYAP Mazbata</span><span>Süre/Tebliğ</span></div>`;
 const body=rows.length?`<div class="notice-table">${header}<div id="noticeRows">${rows.map(row).join('')}</div></div>`:empty('Henüz tebligat kaydı yok. Yeni UYAP evrakları işlendiğinde bu ekran otomatik dolacak.');
 mount(pageHero('Tebligatlar','UYAP evrakı → barkod → PTT → mazbata → avukat süre kontrolü.')+
   `<div class="notice-topline">${filters}</div>`+
   section('Tebligat Takibi','✉',body,'<button id="scanNoticeDocs" class="subtle-action">Belge Tara</button>')+section('Sağlayıcı ve Hukuki Güvence','§',providerBox),'notices');

 const statusMatch=(mode,status)=>{
   if(mode==='all')return true;
   if(mode==='waiting')return ['pending','in_transit','provider_error','needs_review'].includes(status);
   if(mode==='delivered')return status==='delivered';
   if(mode==='receipt')return status==='receipt_received';
   return true;
 };
 document.querySelector('#scanNoticeDocs')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;e.currentTarget.textContent='Taranıyor…';await api.scanNotificationDocuments({});renderNotices()});
 document.querySelectorAll('[data-nfilter]').forEach(btn=>btn.onclick=()=>{
   document.querySelectorAll('[data-nfilter]').forEach(x=>x.classList.remove('active'));btn.classList.add('active');
   document.querySelectorAll('.notice-table-row').forEach(r=>r.style.display=statusMatch(btn.dataset.nfilter,r.dataset.status)?'grid':'none');
 });
}
