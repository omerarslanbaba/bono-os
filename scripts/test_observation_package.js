'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {build}=require('./build_observation_package');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bono-package-')),target=path.join(tmp,'target'),output=path.join(tmp,'bundle');
fs.mkdirSync(path.join(target,'bridge'),{recursive:true});fs.writeFileSync(path.join(target,'bridge/server.js'),'// synthetic local modification\nmodule.exports={preserved:true};');
const manifest=build(target,output);assert.equal(manifest.files.length,12);assert(fs.readFileSync(path.join(output,'payload/bridge/server.js'),'utf8').includes('synthetic local modification'));
let port;
const run=mode=>spawnSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(output,'observation_package.ps1'),'-TargetRoot',target,'-Mode',mode,'-CorePort',String(port)],{encoding:'utf8'});
(async()=>{
port=await new Promise(resolve=>{const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
for(const mode of ['Verify','Apply','Rollback']){const r=run(mode);assert.equal(r.status,0,r.stdout+r.stderr);}
assert.equal(fs.readFileSync(path.join(target,'bridge/server.js'),'utf8'),'// synthetic local modification\nmodule.exports={preserved:true};');assert(!fs.existsSync(path.join(target,'extension/runtime_mode.js')));
fs.appendFileSync(path.join(target,'bridge/server.js'),'changed');assert.notEqual(run('Apply').status,0);
console.log(JSON.stringify({ok:true,tests:['preserve_local_server_changes','verify_read_only','apply_synthetic_target','rollback_exact_preimage','changed_preimage_rejected'],buildId:manifest.buildId}));
})().catch(e=>{console.error(e);process.exitCode=1;});
