'use strict';
// Read-only against the explicit installation root. Never copies databases or settings.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function build(target,output){
 target=path.resolve(target);output=path.resolve(output);
 if(output===target||output.startsWith(target+path.sep))throw Error('output_must_be_isolated');
 if(fs.existsSync(output))throw Error('output_exists');
 const files=['extension/runtime_mode.js','extension/manifest.json','extension/background.js','extension/content.js','extension/page_probe.js','extension/observation_contracts.js','extension/controlled_probe.js','extension/observation.html','extension/observation_ui.js','bridge/server.js','bridge/observation_controller.js','bridge/observation_server.js'];
 const data=new Map(files.filter(f=>f!=='extension/runtime_mode.js').map(f=>[f,fs.readFileSync(path.join(repo,f))]));
 // Preserve every live server change: wrap the preimage instead of replacing it with integration code.
 const preServer=fs.readFileSync(path.join(target,'bridge/server.js'),'utf8');
 if(preServer.includes('BONO_OBSERVATION_ONLY'))throw Error('already_patched_source');
 data.set('bridge/server.js',Buffer.from("if(process.env.BONO_OBSERVATION_ONLY==='1'){require('./observation_server').start();}else{\n"+preServer+'\n}\n'));
 const buildId=hash([...data].sort(([a],[b])=>a.localeCompare(b)).map(([f,b])=>f+':'+hash(b)).join('\n'));
 data.set('extension/runtime_mode.js',Buffer.from('var BONO_RUNTIME_CONFIG=Object.freeze('+JSON.stringify({mode:'observation_only',buildId,probeVersion:2})+');\n'));
 const manifest={schema:1,mode:'observation_only',buildId,createdAt:new Date().toISOString(),files:[]};
 for(const f of files){
  const old=path.join(target,f),bytes=data.get(f),before=fs.existsSync(old)?fs.readFileSync(old):null;
  manifest.files.push({path:f,sha256:hash(bytes),beforeSha256:before?hash(before):null});
  for(const [folder,body] of [['payload',bytes],['rollback',before]])if(body){const dest=path.join(output,folder,f);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,body);}
 }
 fs.writeFileSync(path.join(output,'version-manifest.json'),JSON.stringify(manifest,null,2));
 for(const name of ['observation_package.ps1','launch_observation.ps1'])fs.copyFileSync(path.join(__dirname,name),path.join(output,name));
 return manifest;
}
if(require.main===module){const [, ,target,output]=process.argv;if(!target||!output)throw Error('usage: target_installation_root isolated_output');console.log(JSON.stringify(build(target,output),null,2));}
module.exports={build};
