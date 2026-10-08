import {api} from '../api.js';
import {mount,pageHero,section,empty,esc,badge,kpi} from '../ui.js';

let ctx={templates:[],clients:[],files:[]};
const fmt=n=>new Intl.NumberFormat('tr-TR').format(Number(n||0));

export async function renderDrafts(id){
 if(id)return renderDraft(id);
 const [s,ds,ts,clients,files]=await Promise.all([api.intelligenceStatus(),api.drafts(),api.templates(),api.clients(),api.officeFiles()]);
 ctx={templates:ts,clients,files};
 const memory=ts.length?ts.slice(0,12).map(t=>`<div class="template-row"><div><div class="doc-title">${esc(t.name)}</div><div class="doc-meta">${esc(t.petition_type||'dilekçe')} · skor ${Math.round((t.template_score||0)*100)}%</div></div><button class="office-style ${t.is_office_style?'active':''}" data-template="${t.id}" data-on="${t.is_office_style?1:0}">${t.is_office_style?'BONO Stili ✓':'Ofis Stili Yap'}</button></div>`).join(''):empty('Henüz şablon adayı yok.');
 const draftRows=ds.length?ds.map(d=>`<a class="data-row draft-cols" href="#drafts/${d.id}"><span><strong>${esc(d.title)}</strong><small>${esc(d.draft_type)} · v${d.version}</small></span><span>${esc(d.office_file_no||'—')}</span><span>${esc(d.client_name||'—')}</span><span>${d.udf_path?'UDF ✓':esc(d.status)}</span><span>→</span></a>`).join(''):empty('Henüz taslak yok. İlk taslağı UDF şablon hafızasından oluşturabilirsin.');
 const action='<button id="newDraftBtn" class="primary-action">Yeni UDF Taslak</button>';
 const reindex='<button id="reindexUdf" class="subtle-action">UDF Hafızasını Yenile</button>';
 mount(pageHero('Taslaklar ve Dilekçe Hafızası','Geçmiş UDF dilekçelerinden stil/iskelet öğren; yeni taslağı UDF olarak üret.')+
  `<div class="kpis">${kpi('▤','Analiz edilmiş UDF',fmt(s.analyzed))}${kpi('◫','Bilgi parçaları',fmt(s.chunks))}${kpi('✎','BONO stil adayı',fmt(s.officeStyleCandidates))}${kpi('□','Taslaklar',fmt(s.drafts))}</div>`+
  `<div class="grid"><div class="section-stack">${section('Taslaklar','✎',`<div class="data-table"><div class="data-head draft-cols"><span>Taslak</span><span>Föy</span><span>Müvekkil</span><span>Durum</span><span></span></div>${draftRows}</div>`,action)}</div>`+
  `<div class="section-stack">${section('Dilekçe Hafızası','◆',memory,reindex)}${section('UDF Güvenliği','⚖','<div class="empty">Eski imza dosyaları kopyalanmaz. BONO yalnız imzasız taslak UDF üretir; son kontrol ve imza UYAP Doküman Editörü’nde yapılır.</div>')}</div></div>`,'drafts');
 document.querySelector('#newDraftBtn')?.addEventListener('click',openDraftModal);
 document.querySelector('#reindexUdf')?.addEventListener('click',async e=>{const b=e.currentTarget;b.disabled=true;b.textContent='Kuyruğa alındı…';await api.enqueue('analyze_udf_library',{},'manual-udf-index:'+Date.now(),45);setTimeout(()=>renderDrafts(),1800)});
 document.querySelectorAll('.office-style').forEach(b=>b.onclick=async e=>{const btn=e.currentTarget;btn.disabled=true;await api.setTemplateOfficeStyle(btn.dataset.template,btn.dataset.on!=='1');renderDrafts()});
}

async function openDraftModal(){
 const w=document.createElement('div');w.className='modal-backdrop';
 const opts=ctx.templates.map(t=>`<option value="${t.id}">${esc(t.is_office_style?'★ ':'')}${esc(t.name)}</option>`).join('');
 const clients=ctx.clients.map(c=>`<option value="${c.id}">${esc(c.display_name)}</option>`).join('');
 const files=ctx.files.map(f=>`<option value="${f.id}">${esc((f.file_no||'—')+' · '+f.title)}</option>`).join('');
 w.innerHTML=`<div class="modal modal-wide"><h2>Yeni UDF Taslak</h2><div class="form-grid"><label>Başlık<input id="dTitle" placeholder="Cevap dilekçesi"></label><label>Tür<select id="dType"><option value="cevap_dilekcesi">Cevap Dilekçesi</option><option value="beyan_dilekcesi">Beyan Dilekçesi</option><option value="itiraz_dilekcesi">İtiraz Dilekçesi</option><option value="istinaf">İstinaf</option><option value="savunma">Savunma</option><option value="talep_dilekcesi">Talep Dilekçesi</option><option value="dava_dilekcesi">Dava Dilekçesi</option></select></label><label>Geçmiş UDF şablonu<select id="dTemplate"><option value="">Şablonsuz</option>${opts}</select></label><label>Müvekkil<select id="dClient"><option value="">—</option>${clients}</select></label><label>Föy<select id="dFile"><option value="">—</option>${files}</select></label></div><div class="modal-actions"><button id="cancelDraft">Vazgeç</button><button id="saveDraft" class="primary-action">Taslağı Aç</button></div><div id="draftError" class="form-error"></div></div>`;
 document.body.appendChild(w);document.querySelector('#cancelDraft').onclick=()=>w.remove();
 document.querySelector('#saveDraft').onclick=async()=>{const b=document.querySelector('#saveDraft');b.disabled=true;try{
  const templateId=document.querySelector('#dTemplate').value||null;let structure=[];
  if(templateId){const t=await api.template(templateId);structure=t.structure?.sections||[]}
  const headings=structure.length?structure:['AÇIKLAMALAR','HUKUKİ NEDENLER','DELİLLER','SONUÇ VE İSTEM'];
  const md=['|**[MAHKEME / MERCİ]**','','**DOSYA NO** : [Esas No]','',...headings.flatMap(h=>['|**'+h+'**','','[İçerik]',''])].join('\n');
  const d=await api.createDraft({title:document.querySelector('#dTitle').value||document.querySelector('#dType').selectedOptions[0].text,draftType:document.querySelector('#dType').value,templateId,clientId:document.querySelector('#dClient').value||null,officeFileId:document.querySelector('#dFile').value||null,contentMd:md});
  w.remove();location.hash='#drafts/'+d.id;
 }catch(e){document.querySelector('#draftError').textContent=e.message;b.disabled=false}};
}

async function renderDraft(id){
 const d=await api.draft(id);
 const refs=(d.sourceRefs||[]).length?d.sourceRefs.map(x=>`<div class="doc-meta">${esc(JSON.stringify(x))}</div>`).join(''):empty('Henüz kaynak evrak seçilmedi.');
 mount(`<div class="case-header"><div class="crumb"><a href="#drafts">Taslaklar</a> / #${d.id}</div><h1>${esc(d.title)}</h1><div class="chips"><span class="chip">${esc(d.draft_type)}</span><span class="chip">v${d.version}</span><span class="chip">${esc(d.template_name||'Şablonsuz')}</span><span class="chip">${d.udf_path?'UDF üretildi':'UDF bekliyor'}</span></div></div>`+
  `<div class="draft-workspace"><div class="card editor-card"><div class="editor-toolbar"><strong>UDF İçeriği</strong><span class="doc-meta">| = ortala · **kalın** · *italik* · __altı çizili__ · >>> alıntı</span><div class="top-spacer"></div><button id="saveDraftBody" class="subtle-action">Kaydet</button><button id="exportUdf" class="primary-action">UDF Oluştur</button></div><textarea id="draftEditor" class="draft-editor">${esc(d.content_md||'')}</textarea><div id="draftStatus" class="editor-status">${d.udf_path?'Son UDF: '+esc(d.udf_path):'İmzasız taslak çalışma alanı'}</div></div>`+
  `<div class="section-stack">${section('Kaynaklar','▤',refs)}${section('Güvenlik','⚖','<div class="empty">BONO bu ekrandan UYAP’a gönderim veya e-imza yapmaz. Üretilen UDF self-validation’dan geçer, sonra UYAP Editör’de kontrol edilir.</div>')}</div></div>`,'drafts');
 const editor=document.querySelector('#draftEditor'),status=document.querySelector('#draftStatus');
 document.querySelector('#saveDraftBody').onclick=async()=>{status.textContent='Kaydediliyor…';await api.updateDraft(id,{contentMd:editor.value});status.textContent='Kaydedildi'};
 document.querySelector('#exportUdf').onclick=async e=>{const b=e.currentTarget;b.disabled=true;status.textContent='Önce kaydediliyor…';try{await api.updateDraft(id,{contentMd:editor.value});status.textContent='UDF üretiliyor ve doğrulanıyor…';const r=await api.exportDraftUdf(id);status.textContent='UDF hazır · '+r.validation.paragraphCount+' paragraf · '+r.note;b.textContent='UDF Yeniden Oluştur'}catch(err){status.textContent='Hata: '+err.message}finally{b.disabled=false}};
}