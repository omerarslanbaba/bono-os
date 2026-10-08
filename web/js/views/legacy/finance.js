import {api} from '../api.js';
import {mount,pageHero,section,empty,esc,kpi} from '../ui.js';

const money=(n,c='TRY')=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:c,maximumFractionDigits:2}).format(Number(n||0));
let clients=[],files=[];

export async function renderFinance(){
 const [o,cs,fs]=await Promise.all([api.financeOverview(),api.clients(),api.officeFiles()]);
 clients=cs; files=fs;
 const rows=o.clients.length?o.clients.map(c=>`<a class="data-row finance-cols" href="#clients/${c.id}"><span><strong>${esc(c.display_name)}</strong><small>Müvekkil hesabı</small></span><span>${money(c.contracted)}</span><span>${money(c.paid)}</span><span>${money(Math.max(0,c.contracted-c.paid))}</span><span>→</span></a>`).join(''):empty('Henüz ücret sözleşmesi veya tahsilat kaydı yok.');
 const actions='<div class="head-actions"><button id="newContract" class="subtle-action">Yeni Sözleşme</button><button id="newPayment" class="primary-action">Tahsilat Ekle</button></div>';
 mount(pageHero('Finans','Avukatlık sözleşmesi, kapsadığı föyler, tahsilat, masraf ve karşı vekâlet ücretini ayrı izler.')+
 `<div class="kpis">${kpi('§','Aktif sözleşme',o.contracts)}${kpi('₺','Kararlaştırılan',money(o.contracted))}${kpi('✓','Tahsil edilen',money(o.paid))}${kpi('◷','Bakiye',money(o.outstanding))}</div>`+
 section('Müvekkil Hesapları','₺',`<div class="data-table"><div class="data-head finance-cols"><span>Müvekkil</span><span>Sözleşme</span><span>Tahsilat</span><span>Bakiye</span><span></span></div>${rows}</div>`,actions)+
 `<div class="grid mini-top"><div>${section('Masraflar','−',`<div class="money-big">${money(o.expenses)}</div>`)}</div><div>${section('Karşı Vekâlet Ücreti','+',`<div class="money-big">${money(o.counterFees)}</div>`)}</div></div>`,'finance');
 document.querySelector('#newContract').onclick=contractModal;
 document.querySelector('#newPayment').onclick=paymentModal;
}
function clientOptions(){return clients.map(c=>`<option value="${c.id}">${esc(c.display_name)}</option>`).join('')}
function fileOptions(){return files.map(f=>`<option value="${f.id}">${esc((f.file_no||'—')+' · '+f.title)}</option>`).join('')}

function contractModal(){
 const w=document.createElement('div');w.className='modal-backdrop';
 w.innerHTML=`<div class="modal"><h2>Avukatlık Sözleşmesi</h2>
 <label>Müvekkil<select id="fcClient">${clientOptions()}</select></label>
 <label>Sözleşme Başlığı<input id="fcTitle" placeholder="2026 Avukatlık Ücret Sözleşmesi"></label>
 <label>Kapsadığı Föyler<select id="fcFiles" multiple size="5">${fileOptions()}</select></label>
 <div class="doc-meta">Bir sözleşme birden fazla föyü kapsayabilir. Hiçbiri seçilmezse müvekkil seviyesinde kalır.</div>
 <label>Toplam Ücret<input id="fcTotal" type="number" step="0.01" placeholder="0"></label>
 <label>İmza Tarihi<input id="fcDate" type="date"></label>
 <label>Ödeme Planı<textarea id="fcTerms" rows="3" placeholder="Taksitler / şartlar"></textarea></label>
 <div class="modal-actions"><button id="fcCancel">Vazgeç</button><button id="fcSave" class="primary-action">Kaydet</button></div><div id="fcErr" class="form-error"></div></div>`;
 document.body.appendChild(w);
 w.querySelector('#fcCancel').onclick=()=>w.remove();
 w.querySelector('#fcSave').onclick=async()=>{
  try{
   const officeFileIds=[...w.querySelector('#fcFiles').selectedOptions].map(o=>Number(o.value));
   await api.createFeeContract({clientId:w.querySelector('#fcClient').value,title:w.querySelector('#fcTitle').value,totalFee:Number(w.querySelector('#fcTotal').value||0),signedAt:w.querySelector('#fcDate').value||null,paymentTerms:w.querySelector('#fcTerms').value||null,officeFileIds});
   w.remove();renderFinance();
  }catch(e){w.querySelector('#fcErr').textContent=e.message}
 };
}
function paymentModal(){
 const w=document.createElement('div');w.className='modal-backdrop';
 w.innerHTML=`<div class="modal"><h2>Tahsilat Ekle</h2><label>Müvekkil<select id="pClient">${clientOptions()}</select></label><label>Tutar<input id="pAmount" type="number" step="0.01"></label><label>Tarih<input id="pDate" type="date"></label><label>Açıklama<input id="pDesc" placeholder="1. taksit"></label><div class="modal-actions"><button id="pCancel">Vazgeç</button><button id="pSave" class="primary-action">Kaydet</button></div><div id="pErr" class="form-error"></div></div>`;
 document.body.appendChild(w);w.querySelector('#pCancel').onclick=()=>w.remove();
 w.querySelector('#pSave').onclick=async()=>{try{await api.createFinancialEntry({clientId:w.querySelector('#pClient').value,entryType:'tahsilat',amount:Number(w.querySelector('#pAmount').value),paidAt:w.querySelector('#pDate').value||null,status:'paid',description:w.querySelector('#pDesc').value||null});w.remove();renderFinance()}catch(e){w.querySelector('#pErr').textContent=e.message}};
}