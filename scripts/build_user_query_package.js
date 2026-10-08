'use strict';
// Read-only source acquisition. All output is isolated; no live source mutation.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function once(s,a,b){if(s.split(a).length!==2)throw Error('non_unique_source_anchor:'+a.slice(0,60));return s.replace(a,b);}
function sources(root){const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');const repo=path.join(__dirname,'..');let server=read('bridge/server.js'),u=read('bridge/uyap.js'),worker=read('bridge/worker.js'),ui=read('web/js/views/active/uyap.js');
if(u.includes('runtimePolicy')||u.includes('UYAP_EXECUTION_HELD')||server.includes('BONO_OBSERVATION_ONLY'))throw Error('unexpected_preimage_requires_explicit_rebase');
const current=fs.readFileSync(path.join(repo,'bridge/uyap.js'),'utf8').replace(/\r\n/g,'\n');
u=current.slice(0,current.indexOf('const db='))+u; // policy/boot hold definitions only; preserve remaining live source.
if(u.split('const db=').length!==2)throw Error('uyap_prefix_mismatch');
u=once(u,'function enqueue({commandType,endpointKey,payload,priority=100,notBeforeMs=0}){','function enqueue({commandType,endpointKey,payload,priority=100,notBeforeMs=0}){\n runtimePolicy?.beforeEnqueue({commandType,endpointKey,payload});');
u=once(u,'return Number(r.lastInsertRowid);','const id=Number(r.lastInsertRowid);runtimePolicy?.onEnqueue(id);return id;');
u=once(u,'function recoverSession(source="network_observation"){','function recoverSession(source="network_observation"){\n if(runtimePolicy?.automaticRecoveryAllowed===false){if(runtimePolicy.allowSessionRecovery?.(source)){setSetting("uyap_session_state","ready");setSetting("uyap_session_reason","");}return sessionState();}');
u=once(u,'function claimNext(host,lane="any"){','function claimNext(host,lane="any"){\n if(executionHeld())return {wait:true,reason:"local_return_hold"};const blocked=runtimePolicy?.beforeClaim();if(blocked)return blocked;');
u=once(u,"AND e.enabled=1\n", "AND e.enabled=1\n      ${runtimePolicy?.selectionSql||''}\n");
u=once(u,'if(lane!=="any")LANE_NEXT_ALLOWED_MS[lane]=now+spacing+jitter;','runtimePolicy?.onClaim(row.id);\n    if(lane!=="any")LANE_NEXT_ALLOWED_MS[lane]=now+spacing+jitter;');
const wrapper=current.slice(current.indexOf('function reportResult(id,result={}){'),current.indexOf('function reportResultUnchecked(id,result={}){'));
u=once(u,'function reportResult(id,result={}){',wrapper+'function reportResultUnchecked(id,result={}){');
u=once(u,'module.exports={GLOBAL_MIN_INTERVAL_MS,','module.exports={setRuntimePolicy,executionHeld,GLOBAL_MIN_INTERVAL_MS,');
// Retain the CBS fail-closed import gate even for internal callers.
u=once(u,'function upsertRemoteList(caseId,data,{baseline=false}={}){','function upsertRemoteList(caseId,data,{baseline=false}={}){\n require("../extension/observation_contracts").assertImportAllowed(db.prepare("SELECT * FROM cases WHERE id=?").get(Number(caseId)));');
server=once(server,'const {Worker}=require("worker_threads");','const {Worker}=require("worker_threads");\nfor(const lock of [".bono-query-transition.lock",".bono-package.lock"])if(fs.existsSync(path.join(__dirname,"..",lock)))throw Error("maintenance_active");');
server=once(server,'const uyap=require("./uyap");','const uyap=require("./uyap");\nconst userQueries=require("./uyap_user_queries").install(db,uyap);');
server=once(server,'  try{\n    if(req.method', '  try{\n    if(await require("./uyap_user_query_http")(req,res,{path:p,origin:"http://127.0.0.1:"+PORT,service:userQueries,json,readBody}))return;\n    if(req.method');
server=once(server,'ui:true,schema:9','ui:true,schema:9,uyapExecutionHeld:uyap.executionHeld(),userQueryPolicy:require("./uyap_user_queries").ready(db)?"user_controlled":"held"');
worker=once(worker,'const uyap=require("./uyap");','const uyap=require("./uyap");\nrequire("./uyap_user_queries").install(db,uyap);');
ui="import {mountUserQueries,mountGlobalQueryHistory} from './user-queries.js';\n"+ui;
ui=once(ui,"queryForm(rows)+discoveryBar(status,archive)+section", "'<p>Geniş keşif kapalı. Sorgulama dosya içinden açık kullanıcı işlemiyle yapılır.</p>'+section");
ui=once(ui,'  bindQuery(rows);','  mountGlobalQueryHistory();');
ui=once(ui,'<div class="file-actionbar"><button id="syncUyapDocs"','<div class="file-actionbar case-sync-panel"><p id="syncUyapStatus"></p><button id="syncUyapDocs"');
const start=ui.indexOf("  document.querySelector('#syncUyapDocs:not(:disabled)')?.addEventListener");if(start<0)throw Error('missing_ui_anchor');const end=ui.indexOf('\n',start);ui=ui.slice(0,start)+'  mountUserQueries(id,()=>renderCase(id));'+ui.slice(end);
return {'bridge/server.js':server,'bridge/uyap.js':u,'bridge/worker.js':worker,'web/js/views/active/uyap.js':ui};
}
function build(root,out){root=fs.realpathSync(root);out=path.resolve(out);if(fs.existsSync(out)||out.toLowerCase().startsWith((root+path.sep).toLowerCase()))throw Error('new_isolated_output_required');
const values=sources(root),repo=path.join(__dirname,'..');
for(const p of ['bridge/uyap_user_queries.js','bridge/uyap_user_query_http.js','web/js/views/active/user-queries.js',...['background.js','content.js','page_probe.js','observation_contracts.js','controlled_probe.js','runtime_mode.js','observation.html','observation_ui.js','manifest.json'].map(n=>'extension/'+n)])values[p]=fs.readFileSync(path.join(repo,p));
const manifestExtension=JSON.parse(values['extension/manifest.json']);manifestExtension.version='0.4.0';values['extension/manifest.json']=JSON.stringify(manifestExtension,null,2);
const extensionBuildId=sha(JSON.stringify(Object.entries(values).filter(([p])=>p.startsWith('extension/')&&p!=='extension/runtime_mode.js').map(([p,b])=>[p,sha(Buffer.from(b))])));values['extension/runtime_mode.js']="var BONO_RUNTIME_CONFIG=Object.freeze("+JSON.stringify({mode:'normal',buildId:extensionBuildId,probeVersion:2})+");\n";
const files=[];for(const [p,bytes]of Object.entries(values)){const dest=path.join(out,'payload',p),live=path.join(root,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);const old=fs.existsSync(live)?fs.readFileSync(live):null;files.push({path:p,sha256:sha(Buffer.from(bytes)),beforeSha256:old?sha(old):null});if(old){const back=path.join(out,'rollback',p);fs.mkdirSync(path.dirname(back),{recursive:true});fs.writeFileSync(back,old);}}
const tools=[];for(const n of ['observation_package.ps1','package_operations.js','query_transition.ps1','query_transition.js']){let bytes=fs.readFileSync(path.join(__dirname,n));if(n==='query_transition.js')bytes=Buffer.from(bytes.toString().replace("require('../bridge/uyap_user_queries')","require('./payload/bridge/uyap_user_queries')").replace("root=fs.realpathSync(root);source=fs.realpathSync(source);","root=fs.realpathSync(root);if(mode==='BackupMigrate'&&require('./package_operations').inspect(__dirname,root).state!=='installed')throw Error('verified_install_required');source=fs.realpathSync(source);"));fs.writeFileSync(path.join(out,n),bytes);tools.push({path:n,sha256:sha(bytes)});}
const m={schema:2,mode:'user_controlled',extensionBuildId,buildId:sha(JSON.stringify({files,tools})),createdAt:new Date().toISOString(),files,tools};fs.writeFileSync(path.join(out,'version-manifest.json'),JSON.stringify(m,null,2));return m;
}
if(require.main===module)console.log(JSON.stringify(build(...process.argv.slice(2))));module.exports={build,sources};
