'use strict';
// An optional, separately approved overlay AFTER the observer package is rolled back.
// Preserve live source bytes except for explicit, single-occurrence guard anchors.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function once(source,from,to){if(source.split(from).length!==2)throw Error('source_anchor_not_unique');return source.replace(from,to);}
function guardedSources(server,uyap){
 if(server.includes('BONO_OBSERVATION_ONLY')||server.includes('BONO_UYAP_EXECUTION_HOLD')||uyap.includes('UYAP_EXECUTION_HELD'))throw Error('source_already_patched');
 server="// Approved local return overlay: restart/watchdog cannot release this hold.\nprocess.env.BONO_UYAP_EXECUTION_HOLD='1';\n"+once(server,'ui:true,schema:9','ui:true,schema:9,uyapExecutionHeld:uyap.executionHeld()');
 uyap='const UYAP_EXECUTION_HELD=process.env.BONO_UYAP_EXECUTION_HOLD==="1";\nfunction executionHeld(){return UYAP_EXECUTION_HELD;}\n'+uyap;
 uyap=once(uyap,'function claimNext(host,lane="any"){','function claimNext(host,lane="any"){\n  if(executionHeld())return {wait:true,reason:"local_return_hold",retryAfterMs:60000};');
 uyap=once(uyap,'function reportResult(id,result={}){','function reportResult(id,result={}){\n  if(executionHeld())return {ok:false,reason:"local_return_hold"};');
 uyap=once(uyap,'module.exports={GLOBAL_MIN_INTERVAL_MS,','module.exports={executionHeld,GLOBAL_MIN_INTERVAL_MS,');
 return {'bridge/server.js':Buffer.from(server),'bridge/uyap.js':Buffer.from(uyap)};
}
function build(target,output){
 target=fs.realpathSync(path.resolve(target));output=path.resolve(output);
 if(output===target||output.startsWith(target+path.sep)||fs.existsSync(output))throw Error('isolated_new_output_required');
 const paths=['bridge/server.js','bridge/uyap.js'],pre=new Map();
 for(const f of paths){const p=path.join(target,f);if(fs.lstatSync(p).isSymbolicLink())throw Error('source_reparse_rejected');pre.set(f,fs.readFileSync(p));}
 const payload=guardedSources(pre.get(paths[0]).toString('utf8'),pre.get(paths[1]).toString('utf8'));
 const toolNames=['observation_package.ps1','package_operations.js'];
 const tools=toolNames.map(p=>({path:p,sha256:digest(fs.readFileSync(path.join(__dirname,p)))}));
 const files=paths.map(p=>({path:p,sha256:digest(payload[p]),beforeSha256:digest(pre.get(p))}));
 const buildId=digest(JSON.stringify({mode:'local_return_hold',files,tools}));
 const manifest={schema:2,mode:'local_return_hold',buildId,createdAt:new Date().toISOString(),files,tools};
 for(const p of paths)for(const [dir,bytes] of [['payload',payload[p]],['rollback',pre.get(p)]]){const dest=path.join(output,dir,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);}
 for(const p of toolNames)fs.copyFileSync(path.join(__dirname,p),path.join(output,p));
 fs.writeFileSync(path.join(output,'version-manifest.json'),JSON.stringify(manifest,null,2));return manifest;
}
if(require.main===module){const [target,output]=process.argv.slice(2);if(!target||!output)throw Error('usage: target_root isolated_output');console.log(JSON.stringify(build(target,output)));}
module.exports={build,guardedSources};
