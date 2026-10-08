'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function hash(file){return fs.existsSync(file)?digest(fs.readFileSync(file)):null;}
function within(root,name){const p=path.resolve(root,name);if(!p.startsWith(root+path.sep))throw Error('unsafe_path');let q=p;while(q!==root){if(fs.existsSync(q)&&fs.lstatSync(q).isSymbolicLink())throw Error('reparse_path_rejected');q=path.dirname(q);}return p;}
function atomic(dest,bytes){fs.mkdirSync(path.dirname(dest),{recursive:true});const tmp=dest+'.bono-stage-'+crypto.randomUUID();try{const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(hash(tmp)!==digest(bytes))throw Error('staging_hash_mismatch');fs.renameSync(tmp,dest);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
function inspect(bundle,root){
 root=fs.realpathSync(path.resolve(root));bundle=fs.realpathSync(path.resolve(bundle));
 const m=JSON.parse(fs.readFileSync(path.join(bundle,'version-manifest.json')));
 if(m.schema!==2||!Array.isArray(m.files)||new Set(m.files.map(f=>f.path)).size!==m.files.length)throw Error('manifest_invalid');
 for(const tool of m.tools||[])if(hash(within(bundle,tool.path))!==tool.sha256)throw Error('tool_hash_mismatch');
 const rows=m.files.map(f=>{const dest=within(root,f.path),payload=within(bundle,'payload/'+f.path),rollback=within(bundle,'rollback/'+f.path);
  if(hash(payload)!==f.sha256||f.beforeSha256&&hash(rollback)!==f.beforeSha256)throw Error('bundle_hash_mismatch');
  return {...f,dest,payload,rollback,current:hash(dest)};});
 return {root,bundle,m,rows,state:rows.every(f=>f.current===f.beforeSha256)?'original':rows.every(f=>f.current===f.sha256)?'installed':rows.every(f=>[f.beforeSha256,f.sha256].includes(f.current))?'partial':'unknown'};
}
async function operate(bundle,root,mode='Verify',port=47831,hooks={}){
 const info=inspect(bundle,root);if(mode==='Verify')return {state:info.state,buildId:info.m.buildId};
 if(!['Apply','Rollback','Recover'].includes(mode))throw Error('invalid_mode');
 const reserved=net.createServer();await new Promise((resolve,reject)=>{reserved.once('error',reject);reserved.listen(port,'127.0.0.1',resolve);});
 const lock=path.join(info.root,'.bono-package.lock'),journal=path.join(info.root,info.m.mode==='local_return_hold'?'.bono-local-return-state.json':info.m.mode==='user_controlled'?'.bono-user-query-state.json':'.bono-package-state.json');let owned=false;
 try{
  if(mode==='Recover'&&fs.existsSync(lock)){
   const bytes=fs.readFileSync(lock),old=JSON.parse(bytes);if(!Number.isInteger(old.pid)||old.buildId!==info.m.buildId)throw Error('unknown_lock');
   try{process.kill(old.pid,0);throw Error('operation_owner_alive');}catch(e){if(e.code!=='ESRCH')throw e;}
   if(!fs.readFileSync(lock).equals(bytes))throw Error('operation_lock_changed');fs.unlinkSync(lock);
  }
  const fd=fs.openSync(lock,'wx');owned=true;fs.writeFileSync(fd,JSON.stringify({pid:process.pid,buildId:info.m.buildId}));fs.closeSync(fd);
  const prior=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal)):null;
  if(prior&&prior.buildId!==info.m.buildId)throw Error('different_build_journal');
  if(info.state==='unknown'&&(mode!=='Recover'||!prior))throw Error('target_changed_requires_explicit_recovery');
  if(mode==='Recover'&&!prior&&info.state!=='original')throw Error('recovery_journal_required');
  atomic(journal,Buffer.from(JSON.stringify({buildId:info.m.buildId,mode,state:'in_progress'})));
  let count=0;
  for(const f of info.rows){
   const desired=mode==='Apply'?f.sha256:f.beforeSha256,current=hash(f.dest);
   if(current===desired)continue;
   if(![f.beforeSha256,f.sha256].includes(current)){
    if(mode!=='Recover')throw Error('target_changed_during_operation');
    if(fs.existsSync(f.dest)){const quarantine=within(info.root,'.bono-observation-recovery/'+crypto.randomUUID()+'/'+f.path);fs.mkdirSync(path.dirname(quarantine),{recursive:true});fs.renameSync(f.dest,quarantine);}
   }
   if(desired===null){if(fs.existsSync(f.dest))fs.unlinkSync(f.dest);}else atomic(f.dest,fs.readFileSync(mode==='Apply'?f.payload:f.rollback));
   if(hash(f.dest)!==desired)throw Error('postimage_hash_mismatch');hooks.afterFile?.(++count,f);
  }
  const final=inspect(bundle,root),expected=mode==='Apply'?'installed':'original';if(final.state!==expected)throw Error('postimage_set_mismatch');
  atomic(journal,Buffer.from(JSON.stringify({buildId:info.m.buildId,mode,state:expected})));
  return {state:expected,buildId:info.m.buildId,postimagesVerified:true};
 }finally{if(owned)fs.unlinkSync(lock);await new Promise(r=>reserved.close(r));}
}
if(require.main===module){const [bundle,root,mode,port]=process.argv.slice(2);operate(bundle,root,mode,Number(port)||47831).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('package_operation_rejected; inspect state and use reviewed recovery');process.exitCode=1;});}
module.exports={operate,inspect,atomic,hash};
