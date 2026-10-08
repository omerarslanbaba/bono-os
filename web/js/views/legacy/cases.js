import {api} from '../api.js';
import {mount,pageHero,section,empty,esc,badge} from '../ui.js';

export async function renderCases(id){
 if(id)return renderCase(id);
 const rows=await api.officeFiles();
 const action='<button id="newFileBtn" class="primary-action">Yeni Föy</button>';
 const body=rows.length?`<div class="data-table"><div class="data-head file-cols"><span>Föy</span><span>Müvekkil</span><span>UYAP Dosyası</span><span>Son Hareket</span><span></span></div>${rows.map(r=>`<a class="data-row file-cols" href="#cases/${r.id}"><span><strong>${esc(r.file_no||'—')}</strong><small>${esc(r.title)}</small></span><span>${esc(r.client_name||'—')}</span><span>${r.case_count}</span><span>${esc(r.last_activity_at||'—')}</span><span>→</span></a>`).join('')}</div>`:empty('Föy yok.');
 mount(pageHero('Dosyalar / Föyler','Föy; UYAP, fiziksel arşiv, kronoloji, müzekkere, delil ve vekâlet kontrolünün ana kimliğidir.')+section('Föy Listesi','□',body,action),'cases');
 document.querySelector('#newFileBtn')?.addEventListener('click',openCreateModal);
}
function openCreateModal(){
 const w=document.createElement('div');w.className='modal-backdrop';
 w.innerHTML=`<div class="modal"><h2>Yeni Föy</h2><label>Föy No<input id="fileNo" placeholder="F-13"></label><label>Başlık<input id="fileTitle"></label><div class="modal-actions"><button id="cancelFile">Vazgeç</button><button id="saveFile" class="primary-action">Oluştur</button></div><div id="fileError" class="form-error"></div></div>`;
 document.body.appendChild(w);w.querySelector('#cancelFile').onclick=()=>w.remove();
 w.querySelector('#saveFile').onclick=async()=>{try{const r=await api.createOfficeFile({fileNo:w.querySelector('#fileNo').value,title:w.querySelector('#fileTitle').value});w.remove();location.hash='#cases/'+r.id}catch(e){w.querySelector('#fileError').textContent=e.message}};
}

const kindLabel=k=>({hearing:'Duruşma',document:'Evrak',uyap_document:'UYAP Evrakı',notification:'Tebligat',deadline:'Süre',task:'Görev',correspondence_sent:'Müzekkere',correspondence_response:'Müzekkere Cevabı'}[k]||k);

async function renderCase(id){
 const f=await api.officeFile(id);
 const [timeline,notes,packs,correspondence,evidence,archive,representation,radar]=await Promise.all([
   api.timeline(id),api.notes({officeFileId:id}),api.hearingPacks(id),api.correspondence(id),api.evidenceMatrix(id),api.archiveSuggestions(id),api.representationRadar(id),api.workRadar({officeFileId:id,status:'open'})
 ]);
 const sync=await Promise.all((f.cases||[]).map(async c=>({case:c,...await api.baselineStatus(c.id)})));

 const filters=[...new Set(timeline.map(x=>x.kind))];
 const timelineBody=timeline.length?`<div class="timeline-filters"><button data-tfilter="all" class="active">Tümü</button>${filters.map(k=>`<button data-tfilter="${esc(k)}">${esc(kindLabel(k))}</button>`).join('')}</div><div id="timelineList">${timeline.map(x=>`<div class="timeline-event" data-kind="${esc(x.kind)}"><div class="timeline-dot"></div><div><div class="doc-title">${esc(x.title)}</div><div class="doc-meta">${esc(x.occurredAt||'Tarih yok')} · ${esc(kindLabel(x.kind))}${x.subtitle?' · '+esc(x.subtitle):''}</div></div></div>`).join('')}</div>`:empty('Henüz kronoloji olayı yok.');

 const corrBody=correspondence.length?correspondence.map(x=>`<div class="correspondence-row"><div><div class="doc-title">${esc(x.institution)} · ${esc(x.subject)}</div><div class="doc-meta">${esc(x.sent_at||x.requested_at||'')} · ${esc(x.status)}${x.status==='sent'&&x.open_days!=null?' · '+x.open_days+' gündür cevap bekleniyor':''}</div></div><div>${x.status==='sent'?'<button class="corr-answer subtle-action" data-id="'+x.id+'">Cevap Geldi</button>':badge(x.status,x.status==='answered'?'green':'')}</div></div>`).join(''):empty('Müzekkere kaydı yok.');

 const evidenceBody=evidence.length?`<div class="evidence-matrix">${evidence.map(i=>`<div class="evidence-issue"><div class="evidence-issue-head"><div><strong>${esc(i.title)}</strong><span>${esc(i.issue_type)}${i.allegation_side?' · '+esc(i.allegation_side):''}</span></div><button class="add-evidence subtle-action" data-id="${i.id}">Delil Bağla</button></div><div class="evidence-links">${i.links.length?i.links.map(l=>`<div class="evidence-link role-${esc(l.evidence_role)}"><span>${esc(l.evidence_role)}</span><strong>${esc(l.title||l.file_name||l.remote_title||l.correspondence_institution||l.link_type)}</strong><small>${esc(l.detail||l.correspondence_subject||'')}</small></div>`).join(''):empty('Henüz delil bağlanmadı.')}</div></div>`).join('')}</div>`:empty('Delil matrisi satırı yok.');

 const verified=archive.find(x=>x.status==='verified');
 const suggested=archive.filter(x=>x.status==='suggested').slice(0,4);
 const archiveBody=verified?`<div class="archive-ok"><strong>✓ ${esc(verified.relative_path)}</strong><span>${verified.file_count} arşiv dosyası · doğrulanmış</span></div>`:
   (suggested.length?suggested.map(x=>`<div class="archive-suggestion"><div><strong>${esc(x.relative_path)}</strong><span>%${Math.round(x.confidence*100)} · ${esc((x.reasons||[]).join(', '))} · ${x.file_count} dosya</span></div><button class="verify-archive primary-action" data-id="${x.id}">Bu Klasör</button></div>`).join(''):empty('Klasör eşleşmesi henüz yok. Arşiv taramasını çalıştır.'));

 const repBody=representation.length?representation.map(r=>`<div class="notice-row"><div><div class="doc-title">${esc(r.court||f.title)} ${esc(r.court_file_no||'')}</div><div class="doc-meta">${r.problems.length?esc(r.problems.join(' · ')):'Vekâlet ve dosya bağlantısı tamam'}</div></div><div class="row-actions">${badge(r.status==='ok'?'Tamam':'Kontrol',r.status==='ok'?'green':'red')}${r.status==='unlinked_power'&&r.candidate_power_id?'<button class="link-power subtle-action" data-case="'+r.case_id+'" data-power="'+r.candidate_power_id+'">Vekâleti Bağla</button>':''}</div></div>`).join(''):empty('Temsil kontrolü için dosya kaydı yok.');

 const syncBody=sync.length?sync.map(s=>`<div class="sync-row"><div><strong>${esc(s.case.court||'UYAP Dosyası')} ${esc(s.case.court_file_no||'')}</strong><span>${s.sync_mode==='delta'?'Delta modu':'İlk arşiv bekleniyor'} · remote ${s.total} · indirilen ${s.downloaded} · dosyalanan ${s.filed}</span></div>${badge(s.sync_mode==='delta'?'Sadece Yeni':'Baseline',s.sync_mode==='delta'?'green':'')}</div>`).join(''):empty('UYAP dosyası henüz bağlı değil.');
 const radarBody=radar.length?radar.map(r=>`<div class="radar-row severity-${esc(r.severity)}"><div class="radar-severity">${esc(({critical:'Kritik',action:'İşlem',warning:'Uyarı',info:'Bilgi'}[r.severity]||r.severity))}</div><div class="radar-copy"><div class="doc-title">${esc(r.title)}</div><div class="doc-meta">${esc(r.detail||'')}</div></div><button class="resolve-file-radar subtle-action" data-id="${r.id}">Tamamlandı</button></div>`).join(''):empty('Bu föyde açık iş radarı kaydı yok.');

 const noteBody=notes.length?notes.slice(0,10).map(n=>`<div class="note-item"><div class="doc-title">${esc(n.title||'Not')}</div><div class="doc-meta">${esc(n.body)}</div></div>`).join(''):empty('Föy notu yok.');
 const casesBody=f.cases.length?f.cases.map(c=>`<div class="notice-row"><div><div class="doc-title">${esc(c.court||'UYAP Dosyası')}</div><div class="doc-meta">${esc(c.court_file_no||'')} · ${esc(c.case_type||'')}</div></div>${badge(c.status||'')}</div>`).join(''):empty('UYAP dosyası yok.');
 const packBody=packs.length?packs.map(p=>`<a class="notice-row clickable" href="#cases/${id}/pack/${p.id}"><div><div class="doc-title">${esc(p.title)}</div><div class="doc-meta">${esc(p.generated_at)}</div></div><span>→</span></a>`).join(''):empty('Hazırlık paketi yok.');

 mount(`<div class="case-header"><div class="crumb"><a href="#cases">Dosyalar</a> / ${esc(f.file_no||('#'+f.id))}</div><h1>${esc(f.title)}</h1><div class="chips"><span class="chip">${esc(f.file_no||'Föy no yok')}</span><span class="chip">${esc(f.client_name||'Müvekkil yok')}</span><span class="chip">${f.cases.length} dosya</span><span class="chip">${esc(f.status||'')}</span></div></div>
 <div class="file-actionbar"><button id="fileNote" class="subtle-action">Not</button><button id="newCorr" class="subtle-action">Müzekkere</button><button id="newIssue" class="subtle-action">Delil Satırı</button><button id="hearingPack" class="primary-action">Duruşma Paketi</button></div>
 <div class="grid"><div class="section-stack">
 ${section('Evrak Kronolojisi','◷',timelineBody)}
 ${section('Delil Matrisi','⚖',evidenceBody,'<button id="newIssue2" class="subtle-action">Vakıa / İsnat Ekle</button>')}
 ${section('Bu Föyde Ara','⌕','<div class="evidence-search"><input id="fileSearch" placeholder="Dosya evraklarında ara…"><button id="fileSearchBtn" class="primary-action">Ara</button></div><div id="fileSearchResults"></div>')}
 </div><div class="section-stack">
 ${section('Fiziksel İş Radarı','◎',radarBody)}
 ${section('Müzekkere Takibi','✉',corrBody,'<button id="newCorr2" class="subtle-action">Yeni Müzekkere</button>')}
 ${section('Fiziksel Arşiv','▤',archiveBody,'<button id="scanArchive" class="subtle-action">Dava Dosyaları Tara</button>')}
 ${section('UYAP Delta Sync','↻',syncBody)}
 ${section('Vekâlet Radarı','♙',repBody)}
 ${section('UYAP Dosyaları','□',casesBody)}
 ${section('Notlar','✎',noteBody)}
 ${section('Duruşma Paketleri','✓',packBody)}
 </div></div>`,'cases');

 document.querySelectorAll('[data-tfilter]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tfilter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('#timelineList [data-kind]').forEach(x=>x.style.display=(b.dataset.tfilter==='all'||x.dataset.kind===b.dataset.tfilter)?'':'none')});
 document.querySelectorAll('.verify-archive').forEach(b=>b.onclick=async()=>{b.disabled=true;b.textContent='Bağlanıyor…';await api.verifyArchiveLink(b.dataset.id);renderCase(id)});
 document.querySelector('#scanArchive')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;e.currentTarget.textContent='Taranıyor…';await api.scanArchive();renderCase(id)});
 document.querySelector('#fileNote').onclick=()=>noteModal(id);
 document.querySelector('#newCorr').onclick=()=>corrModal(id,f.cases);document.querySelector('#newCorr2').onclick=()=>corrModal(id,f.cases);
 document.querySelector('#newIssue').onclick=()=>issueModal(id,f.cases);document.querySelector('#newIssue2').onclick=()=>issueModal(id,f.cases);
 document.querySelectorAll('.corr-answer').forEach(b=>b.onclick=async()=>{await api.markCorrespondenceResponse(b.dataset.id,{});renderCase(id)});
 document.querySelectorAll('.resolve-file-radar').forEach(b=>b.onclick=async()=>{b.disabled=true;await api.resolveWorkRadar(b.dataset.id);renderCase(id)});
 document.querySelectorAll('.link-power').forEach(b=>b.onclick=async()=>{b.disabled=true;await api.linkPowerToCase(b.dataset.case,b.dataset.power);renderCase(id)});
 document.querySelectorAll('.add-evidence').forEach(b=>b.onclick=()=>evidenceLinkModal(id,b.dataset.id,correspondence));
 document.querySelector('#hearingPack').onclick=async()=>{const p=await api.generateHearingPack(id);location.hash='#cases/'+id+'/pack/'+p.id};
 document.querySelector('#fileSearchBtn').onclick=async()=>{const q=document.querySelector('#fileSearch').value.trim(),box=document.querySelector('#fileSearchResults');if(q.length<2)return;const d=await api.knowledgeSearch(q,{officeFileId:id});box.innerHTML=d.results.length?d.results.map(r=>`<a class="evidence-hit" href="#documents/${r.asset_id}"><div><strong>${esc(r.file_name)}</strong><span>${esc(r.heading||r.document_kind||'')}</span></div><p>${esc(r.preview)}</p></a>`).join(''):empty('Eşleşme yok.')};
}
function modal(title,body){const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal modal-wide"><h2>${title}</h2>${body}<div id="modalErr" class="form-error"></div></div>`;document.body.appendChild(w);return w}
function caseOptions(cases){return '<option value="">—</option>'+cases.map(c=>`<option value="${c.id}">${esc((c.court||'')+' '+(c.court_file_no||''))}</option>`).join('')}
function corrModal(fileId,cases){
 const w=modal('Yeni Müzekkere',`<div class="form-grid"><label>UYAP Dosyası<select id="mcCase">${caseOptions(cases)}</select></label><label>Kurum<input id="mcInst" placeholder="SGK / Banka / BTK / Hastane"></label><label>Konu<input id="mcSubject" placeholder="İstenen bilgi / belge"></label><label>Gönderim tarihi<input id="mcSent" type="date"></label></div><label>Not<textarea id="mcNote" rows="3"></textarea></label><div class="modal-actions"><button id="mcCancel">Vazgeç</button><button id="mcSave" class="primary-action">Kaydet</button></div>`);
 w.querySelector('#mcCancel').onclick=()=>w.remove();w.querySelector('#mcSave').onclick=async()=>{try{await api.createCorrespondence({officeFileId:fileId,caseId:w.querySelector('#mcCase').value||null,institution:w.querySelector('#mcInst').value,subject:w.querySelector('#mcSubject').value,sentAt:w.querySelector('#mcSent').value||null,status:w.querySelector('#mcSent').value?'sent':'draft',notes:w.querySelector('#mcNote').value});w.remove();renderCase(fileId)}catch(e){w.querySelector('#modalErr').textContent=e.message}};
}
function issueModal(fileId,cases){
 const w=modal('Delil Matrisi Satırı',`<div class="form-grid"><label>Dosya<select id="eiCase">${caseOptions(cases)}</select></label><label>Tür<select id="eiType"><option value="vakıa">Vakıa</option><option value="isnat">İsnat</option><option value="talep">Talep</option><option value="savunma">Savunma</option></select></label><label>Başlık<input id="eiTitle" placeholder="Fazla çalışma / para nakline aracılık / kusur"></label><label>İddia tarafı<input id="eiSide" placeholder="Davacı / Savcılık / Davalı"></label></div><label>Not<textarea id="eiNote" rows="3"></textarea></label><div class="modal-actions"><button id="eiCancel">Vazgeç</button><button id="eiSave" class="primary-action">Kaydet</button></div>`);
 w.querySelector('#eiCancel').onclick=()=>w.remove();w.querySelector('#eiSave').onclick=async()=>{try{await api.createEvidenceIssue({officeFileId:fileId,caseId:w.querySelector('#eiCase').value||null,issueType:w.querySelector('#eiType').value,title:w.querySelector('#eiTitle').value,allegationSide:w.querySelector('#eiSide').value||null,notes:w.querySelector('#eiNote').value});w.remove();renderCase(fileId)}catch(e){w.querySelector('#modalErr').textContent=e.message}};
}
function evidenceLinkModal(fileId,issueId,corr){
 const opts=corr.map(c=>`<option value="${c.id}">${esc(c.institution+' · '+c.subject)}</option>`).join('');
 const w=modal('Delil Bağla',`<div class="form-grid"><label>Rol<select id="elRole"><option value="favorable">Lehimize</option><option value="adverse">Aleyhe</option><option value="neutral">Nötr</option><option value="missing">Eksik / Bekleniyor</option></select></label><label>Tür<select id="elType"><option value="document">Belge</option><option value="witness">Tanık</option><option value="expert">Bilirkişi</option><option value="correspondence">Müzekkere</option><option value="statement">Beyan</option></select></label></div><label>Başlık<input id="elTitle"></label><label>Müzekkere (opsiyonel)<select id="elCorr"><option value="">—</option>${opts}</select></label><label>Detay<textarea id="elDetail" rows="3"></textarea></label><div class="modal-actions"><button id="elCancel">Vazgeç</button><button id="elSave" class="primary-action">Bağla</button></div>`);
 w.querySelector('#elCancel').onclick=()=>w.remove();w.querySelector('#elSave').onclick=async()=>{try{await api.addEvidenceLink(issueId,{linkType:w.querySelector('#elType').value,evidenceRole:w.querySelector('#elRole').value,correspondenceId:w.querySelector('#elCorr').value||null,title:w.querySelector('#elTitle').value||null,detail:w.querySelector('#elDetail').value||null,status:w.querySelector('#elRole').value==='missing'?'expected':'available'});w.remove();renderCase(fileId)}catch(e){w.querySelector('#modalErr').textContent=e.message}};
}
function noteModal(fileId){
 const w=modal('Föy Notu','<label>Başlık<input id="fnTitle"></label><label>Not<textarea id="fnBody" rows="5"></textarea></label><div class="modal-actions"><button id="fnCancel">Vazgeç</button><button id="fnSave" class="primary-action">Kaydet</button></div>');
 w.querySelector('#fnCancel').onclick=()=>w.remove();w.querySelector('#fnSave').onclick=async()=>{try{await api.createNote({officeFileId:fileId,title:w.querySelector('#fnTitle').value,body:w.querySelector('#fnBody').value});w.remove();renderCase(fileId)}catch(e){w.querySelector('#modalErr').textContent=e.message}};
}
async function renderPack(fileId,packId){const p=await api.hearingPack(packId);mount(`<div class="case-header"><div class="crumb"><a href="#cases/${fileId}">Föye Dön</a></div><h1>${esc(p.title)}</h1></div><div class="grid"><div>${section('Çalışma Özeti','⚖',`<pre class="pack-preview">${esc(p.summary_md||'')}</pre>`)}</div><div>${section('Kontrol Listesi','✓',(p.checklist?.items||[]).map(x=>`<div class="check-row"><span>${x.done?'✓':'○'}</span><strong>${esc(x.label)}</strong></div>`).join(''))}</div></div>`,'cases')}
export async function renderCaseRoute(parts){if(parts[1]&&parts[2]==='pack'&&parts[3])return renderPack(parts[1],parts[3]);return renderCases(parts[1])}
