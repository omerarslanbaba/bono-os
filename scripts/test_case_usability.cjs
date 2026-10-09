const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const {JSDOM}=require(process.env.BONO_UI_TEST_MODULES||'../dist/ui-test-env/node_modules/jsdom');
(async()=>{
 const state=await import('../web/js/case-query-state.mjs');let count=0;
 const check=(name,fn)=>{fn();console.log('PASS',name);count++};
 const success={command_id:10,state:'completed',operation:'cbs.search',result_ref:'command:10',occurred_at:'2030-01-01',legacy:0};
 check('CBS success retained alongside newer queued command',()=>{const v=state.queryOverview([{...success,command_id:11,state:'queued',result_ref:null},success],0);assert.equal(v.label,'Sırada');assert.equal(v.success.command_id,10);assert.match(v.documents,/sorgulandı fakat/)});
 check('never queried differs from complete empty document list',()=>{assert.equal(state.queryOverview().label,'Henüz sorgulanmadı');assert.equal(state.queryOverview([{...success,operation:'document.list'}]).documents,'Evrak listesi alındı, sonuç boş')});
 check('running document list is not empty success',()=>assert.match(state.queryOverview([{...success,operation:'document.list',state:'running'}]).documents,/çalışıyor/));
 check('legacy archive is not query success',()=>assert.equal(state.queryOverview([{...success,legacy:1}]).success,null));
 check('download history cannot become successful query',()=>assert.equal(state.queryOverview([{...success,operation:'document.pdf'}]).success,null));
 check('missing identity/parties not fabricated',()=>assert.equal(state.partyText({}),'Taraf bilgisi kaydedilmemiş'));
 check('opening date only from provided fields',()=>{assert.equal(state.openingDate({synced_at:'2030'}),'');assert.equal(state.openingDate({dosyaAcilisTarihi:{date:{year:2030,month:2,day:3}}}),'2030-02-03')});
 check('queue reason does not invent executor status',()=>assert.match(state.queryWaitReason({state:'queued'},{session:{state:'ready'},rate:{state:'ready'}}),/bildirilmedi/));
 check('Core login denial takes priority over Bridge heartbeat',()=>assert.match(state.queryWaitReason({state:'queued'},{session:{state:'login_required'},bridge:{state:'session_unverified'}}),/yeniden giriş/));
 check('allowlisted Core wait reason is visible without arbitrary text',()=>{assert.match(state.queryWaitReason({state:'queued'},{bridge:{state:'idle',waitReason:'rate_limit'}}),/hız sınırı/);assert(!state.queryWaitReason({state:'queued'},{bridge:{state:'idle',waitReason:'secret-token'}}).includes('secret-token'))});
 check('bridge delivery and readiness diagnostics are explicit',()=>{assert.match(state.queryWaitReason({state:'running',command_id:9},{bridge:{state:'result_delivery_failed',commandId:9}}),/iletilemedi/);assert.match(state.queryWaitReason({state:'queued'},{bridge:{state:'probe_not_ready'}}),/hazır değil/);assert.match(state.queryWaitReason({state:'queued'},{bridge:{state:'bridge_stale'}}),/güncel haber/)});
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/#uyap'}),document=dom.window.document;
 const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 const rows=[{id:1,court:'Eskişehir Cumhuriyet Başsavcılığı',court_file_no:'2030/123',case_type:'CBS',status:'open',party_names:'Sentetik Taraf'}, {id:2,court:'Kocaeli 1. İş Mahkemesi',court_file_no:'2030/9',case_type:'Hukuk',status:'open',client_name:'Sentetik Müvekkil'}, {id:3,court:'Kocaeli 1. İş Mahkemesi',court_file_no:'2029/88',case_type:'Hukuk',status:'closed'}];
 const ctx=vm.createContext({document,window:dom.window,location:dom.window.location,esc,...state,inventoryTotals:()=>({known:3,never:0,partial:0,unknown:3}),api:{uyapCases:async()=>rows},mount:html=>document.getElementById('app').innerHTML=html,pageHero:(a,b)=>`<h1>${a}</h1><p>${b}</p>`,section:(a,b,c)=>`<section><h2>${a}</h2>${c}</section>`,empty:()=>'',badge:()=>''});
 vm.runInContext(fs.readFileSync('web/js/views/active/uyap.js','utf8').replace(/^import .*;\s*$/gm,'').replace(/export /g,''),ctx);await ctx.renderUyap();
 check('district and global history removed; seven table columns',()=>{assert(!document.getElementById('filterDistrict'));assert(!document.getElementById('syncAllUyap'));assert(!document.body.textContent.includes('Kalıcı sorgu geçmişi'));assert.equal(document.querySelectorAll('.case-results-table thead tr:first-child th').length,7)});
 check('column filters initially closed and independent of sorting',()=>{
  assert([...document.querySelectorAll('.case-column-filter')].every(x=>x.hidden));
  document.querySelector('[data-filter-toggle="1"]').onclick();
  assert.equal(document.getElementById('column-filter-1').hidden,false);
  document.querySelector('[data-case-sort="1"]').onclick();
  assert.equal(document.getElementById('column-filter-1').hidden,false);
  document.querySelector('[data-filter-toggle="5"]').onclick();
  assert.equal(document.getElementById('column-filter-1').hidden,true);
  assert.equal(document.getElementById('column-filter-5').hidden,false);
 });
 check('column filter selects correct case and recorded party',()=>{const e=document.querySelector('[data-column-filter="5"]');e.value='Sentetik Taraf';e.oninput();assert.equal([...document.querySelectorAll('.case-list-row')].filter(x=>!x.hidden)[0].dataset.caseId,'1');assert.equal(document.getElementById('case-row-1').querySelector('a').getAttribute('href'),'#uyap/1');e.value='';e.oninput()});
 check('type switches units using local records',()=>{const e=document.getElementById('filterType');e.value='CBS';e.onchange();assert.equal([...document.querySelectorAll('.case-list-row')].filter(x=>!x.hidden).length,1);assert.match(document.getElementById('filterUnit').textContent,/BAŞSAVCILIĞI/);e.value='';e.onchange()});
 check('sort and row click preserve exact BONO ID',()=>{document.querySelector('[data-case-sort="1"]').onclick();const row=document.getElementById('case-row-2');row.onclick({target:row});assert.equal(dom.window.location.hash,'#uyap/2')});
 check('no matches shown explicitly',()=>{document.getElementById('filterQuery').value='bulunmayan';document.getElementById('filterQuery').oninput();assert.equal(document.getElementById('noCaseMatches').hidden,false)});
 ctx.inventoryState=(await import('../web/js/inventory-state.mjs')).inventoryState;ctx.api.uyapRemoteDocuments=async()=>[];ctx.api.accountingOverview=async()=>({});ctx.fetch=async()=>({ok:true,json:async()=>[success]});ctx.mountUserQueries=()=>{};
 await ctx.renderCase(1);
 check('detail starts with identity header; technical/history collapsed; no duplicate empty list',()=>{assert(document.querySelector('.case-header'));assert.equal(document.querySelector('.case-technical').open,false);assert.match(document.getElementById('documentListSummary').textContent,/sorgulandı fakat/);assert.equal(document.querySelectorAll('.case-document-guidance').length,0);assert.equal(document.getElementById('queueCaseDownloads').disabled,true)});
 const querySource=fs.readFileSync('web/js/views/active/user-queries.js','utf8').replace(/^import .*;\s*$/gm,'').replace(/export /g,'');
 async function harness({history=[],reply={state:'cache_hit',commandId:10},error=null,options=[]}={}){
  const dom=new JSDOM('<div class="case-sync-panel"><button id="syncUyapDocs"></button><small id="syncUyapStatus"></small></div><p id="lastQuerySummary"></p><p id="documentListSummary"></p><div id="queryTechnicalDetails"></div><div id="caseQueryHistory"></div><div class="case-download-controls"><button id="queueCaseDownloads" disabled></button><small id="caseDownloadStatus"></small></div>',{url:'http://localhost/#uyap/1'});
  const calls=[],timers=[],completed=[];const downloadOptions=options;const ctx=vm.createContext({document:dom.window.document,window:dom.window,esc,...state,crypto:require('node:crypto').webcrypto,confirm:()=>false,setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout:()=>{},fetch:async(url,options)=>{calls.push({url,options});if(options?.method==='POST'&&error)throw Error(error);const data=options?.method==='POST'?reply:url.endsWith('query-support')?{supported:true,operation:'cbs.search'}:url.endsWith('query-history')?history:url.endsWith('/session')?{session:{state:'ready',manualDownloadPaused:true},rate:{state:'ready'}}:url.endsWith('/download-options')?downloadOptions:[];return {ok:true,json:async()=>data}}});
  vm.runInContext(querySource,ctx);await ctx.mountUserQueries(1,async m=>completed.push(m));return {dom,calls,timers,completed};
 }
 let h=await harness();await h.dom.window.document.getElementById('syncUyapDocs').onclick();check('cache hit visibly refreshes detail without claiming UYAP query',()=>{assert.equal(h.completed.length,1);assert.match(h.completed[0],/yeni UYAP sorgusu yapılmadı/);assert.equal(h.calls.filter(x=>x.options?.method==='POST').length,1)});
 h=await harness({history:[{...success,command_id:11,state:'queued',result_ref:null},success]});await h.timers[0]();check('existing queue automatically monitored using GET only',()=>{assert.equal(h.calls.filter(x=>x.options?.method==='POST').length,0);assert(h.dom.window.document.getElementById('syncUyapDocs').disabled);assert.match(h.dom.window.document.getElementById('lastQuerySummary').textContent,/Son başarılı/);assert.match(h.dom.window.document.getElementById('queryTechnicalDetails').textContent,/#11/)});
 h=await harness({error:'bağlantı kesildi'});await h.dom.window.document.getElementById('syncUyapDocs').onclick();await h.dom.window.document.getElementById('syncUyapDocs').onclick();check('error visible; request key retained; no silent retry',()=>{assert.match(h.dom.window.document.getElementById('syncUyapStatus').textContent,/bağlantı kesildi/);const posts=h.calls.filter(x=>x.options?.method==='POST');assert.equal(JSON.parse(posts[0].options.body).requestKey,JSON.parse(posts[1].options.body).requestKey)});
 h=await harness({reply:{state:'cache_miss'}});await h.dom.window.document.getElementById('syncUyapDocs').onclick();check('cache miss explicit and no fabricated completion',()=>{assert.match(h.dom.window.document.getElementById('syncUyapStatus').textContent,/önbellek bulunamadı/);assert.equal(h.completed.length,0)});
 check('no unpause requests or default download writes',()=>{assert(!querySource.includes("read('/api/uyap/download-pause'"));assert(h.dom.window.document.getElementById('queueCaseDownloads').disabled);assert(!h.calls.some(x=>/approved-downloads/.test(x.url)))});
 h=await harness({options:[{id:8},{id:9}]});await h.dom.window.document.getElementById('queueCaseDownloads').onclick();
 check('verified download options selected by default; declined confirmation performs zero writes',()=>{
  assert.equal(h.dom.window.document.querySelectorAll('input:checked').length,2);
  assert.equal(h.calls.filter(x=>x.options?.method==='POST').length,0);
  assert.match(h.dom.window.document.getElementById('queueCaseDownloads').textContent,/Evrakları İndir/);
 });
 console.log(count+' usability tests PASS; synthetic API only');
})().catch(e=>{console.error(e);process.exitCode=1});
