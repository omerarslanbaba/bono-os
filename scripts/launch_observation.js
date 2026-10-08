'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {inspect}=require('./package_operations');
async function launch(bundle,root,source,evidence,extensionId,port=47831){
 const info=inspect(bundle,root);if(info.state!=='installed')throw Error('installed_hash_mismatch');
 if(!/^[a-p]{32}$/.test(extensionId)||!fs.existsSync(source)||fs.existsSync(evidence))throw Error('invalid_paths_or_extension');
 if(fs.realpathSync(source).toLowerCase()===path.resolve(evidence).toLowerCase())throw Error('separate_evidence_required');
 const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(source,{readOnly:true});try{db.prepare('SELECT court_file_no,uyap_birim_id,uyap_dosya_id FROM cases LIMIT 0').all();}finally{db.close();}
 const child=spawn(process.execPath,[path.join(info.root,'bridge/server.js')],{env:{...process.env,BONO_OBSERVATION_ONLY:'1',BONO_DB_PATH:path.resolve(source),BONO_OBSERVATION_DB_PATH:path.resolve(evidence),BONO_OBSERVATION_BUILD_ID:info.m.buildId,BONO_OBSERVATION_EXTENSION_ID:extensionId,BONO_PORT:String(port)},stdio:['pipe','ignore','ignore'],windowsHide:true});
 let exited=false;const completion=new Promise(resolve=>{child.once('error',()=>{exited=true;resolve(1);});child.once('exit',code=>{exited=true;resolve(code===0?0:1);});});
 let stopping=false;
 const shutdown=()=>{if(!exited&&!stopping){stopping=true;child.stdin.end('stop\n');}};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 const keepAlive=setInterval(()=>{},1000);
 try{
  let ready=false;
  for(let i=0;i<100&&!exited;i++){
   try{const r=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(150)}),h=await r.json();if(r.ok&&h.observationOnly===true&&h.buildId===info.m.buildId&&h.pid===child.pid){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,50));
  }
  if(!ready){shutdown();await Promise.race([completion,new Promise(r=>setTimeout(r,2000))]);if(!exited)child.kill();throw Error('observer_not_ready');}
  console.log(JSON.stringify({state:'ready',mode:'observation_only',buildId:info.m.buildId,pid:child.pid,port}));
  process.stdin.on('data',shutdown);process.stdin.on('end',shutdown);process.stdin.resume();return await completion;
 }finally{clearInterval(keepAlive);process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);process.stdin.pause();}
}
if(require.main===module){const [bundle,root,source,evidence,id,port]=process.argv.slice(2);launch(bundle,root,source,evidence,id,Number(port)||47831).then(code=>{process.exitCode=code;}).catch(()=>{console.error('observer_launch_failed');process.exitCode=1;});}
module.exports={launch};
