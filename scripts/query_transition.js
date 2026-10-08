'use strict';
// Supported entry point is query_transition.ps1, with services stopped. Never imports live db.js.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const policy=require('../bridge/uyap_user_queries');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function verifyBackup(dir,source){const m=JSON.parse(fs.readFileSync(path.join(dir,'backup-manifest.json')));if(m.schema!==1||m.source!==source||!m.verified)throw Error('backup_manifest_mismatch');for(const f of m.files){if(!['source.db','source.db-wal','source.db-shm'].includes(f.name)||sha(path.join(dir,f.name))!==f.sha256)throw Error('backup_hash_mismatch');}return m;}
function backup(source,dir){
 if(fs.existsSync(dir))return verifyBackup(dir,source);
 fs.mkdirSync(dir,{recursive:true});const files=[];
 for(const suffix of ['','-wal','-shm']){const from=source+suffix;if(!fs.existsSync(from))continue;const before=sha(from),name='source.db'+suffix;fs.copyFileSync(from,path.join(dir,name),fs.constants.COPYFILE_EXCL);if(sha(from)!==before||sha(path.join(dir,name))!==before)throw Error('source_changed_during_backup');files.push({name,sha256:before});}
 const validation=path.join(dir,'validation');fs.mkdirSync(validation);for(const f of files)fs.copyFileSync(path.join(dir,f.name),path.join(validation,f.name));
 const db=new DatabaseSync(path.join(validation,'source.db'),{readOnly:true});let rows,counts;try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('backup_integrity_failed');rows=db.prepare("SELECT id FROM uyap_command_queue WHERE status='queued' ORDER BY id").all();counts=db.prepare('SELECT status,count(*) count FROM uyap_command_queue GROUP BY status').all();if(db.prepare("SELECT count(*) n FROM uyap_command_queue WHERE status IN ('running','dispatched')").get().n)throw Error('active_commands');}finally{db.close();}
 // Recheck all source files after validation, before the migration can start.
 for(const suffix of ['','-wal','-shm'])if(fs.existsSync(source+suffix)!==files.some(f=>f.name==='source.db'+suffix))throw Error('source_files_changed');
 for(const f of files){const suffix=f.name.slice('source.db'.length);if(sha(source+suffix)!==f.sha256)throw Error('source_changed_during_backup');}
 const m={schema:1,verified:true,source,createdAt:new Date().toISOString(),files,queueIdDigest:policy.digest(rows.map(r=>r.id)),queueCommandIds:rows.map(r=>r.id),counts};fs.writeFileSync(path.join(dir,'backup-manifest.json'),JSON.stringify(m,null,2),{flag:'wx'});return m;
}
async function transition(root,source,dir,mode='BackupMigrate',port=47831){
 root=fs.realpathSync(root);source=fs.realpathSync(source);dir=path.resolve(dir);
 const contained=(base,p)=>p.toLowerCase().startsWith((base+path.sep).toLowerCase());
 if(!contained(path.join(root,'data'),source)||contained(root,dir))throw Error('invalid_transition_paths');
 const gate=net.createServer();await new Promise((resolve,reject)=>{gate.once('error',reject);gate.listen(port,'127.0.0.1',resolve);});
 const lock=path.join(root,'.bono-query-transition.lock');let fd;
 try{fd=fs.openSync(lock,'wx');fs.writeSync(fd,JSON.stringify({pid:process.pid,mode}));
  if(mode==='VerifyBackup')return verifyBackup(dir,source);
  if(mode==='BackupOnly')return backup(source,dir);
  if(mode==='RollbackHold'){const db=new DatabaseSync(source);try{policy.rollbackHold(db);return {state:'rollback_hold',retirementsPreserved:true};}finally{db.close();}}
  if(mode!=='BackupMigrate')throw Error('unsupported_transition_mode');
  const manifest=backup(source,dir),db=new DatabaseSync(source);try{return policy.migrate(db,{expectedQueued:270,backupManifest:manifest});}finally{db.close();}
 }finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}await new Promise(r=>gate.close(r));}
}
if(require.main===module){const [root,source,dir,mode,port]=process.argv.slice(2);transition(root,source,dir,mode,Number(port)||47831).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('query_transition_rejected; no automatic restore or queue revival');process.exitCode=1;});}
module.exports={transition,backup,verifyBackup};
