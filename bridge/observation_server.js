'use strict';
const http=require('node:http'),path=require('node:path'),fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const {ObservationController}=require('./observation_controller');
function start(env=process.env){
 const evidencePath=env.BONO_OBSERVATION_DB_PATH,sourcePath=env.BONO_DB_PATH;
 if(!evidencePath||!sourcePath||!fs.existsSync(sourcePath)||fs.existsSync(evidencePath)||fs.realpathSync(sourcePath).toLowerCase()===path.resolve(evidencePath).toLowerCase())throw new Error('new_separate_observation_db_required');
 if(!/^[a-p]{32}$/.test(env.BONO_OBSERVATION_EXTENSION_ID||''))throw new Error('extension_id_required');
 if(!/^[a-f0-9]{64}$/.test(env.BONO_OBSERVATION_BUILD_ID||''))throw new Error('build_id_required');
 // The source-side lease excludes a second observer even on a different port.
 const lease=require('./observation_lease').acquire(sourcePath);
 let source,db,controller,ready=false;
 const reply=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 const server=http.createServer(async(req,res)=>{
  try{
   const route=new URL(req.url,'http://127.0.0.1').pathname;
   if(req.method==='GET'&&route==='/health')return reply(res,ready?200:503,{ok:ready,observationOnly:true,buildId:env.BONO_OBSERVATION_BUILD_ID,pid:process.pid});
   if(!ready)return reply(res,503,{error:'not_ready'});
   if(route==='/api/uyap/commands/next'){res.writeHead(204);return res.end();}
   const origin=req.headers.origin;
   if((origin&&origin!=='chrome-extension://'+env.BONO_OBSERVATION_EXTENSION_ID)||req.headers['x-bono-extension-id']!==env.BONO_OBSERVATION_EXTENSION_ID)return reply(res,403,{error:'client_rejected'});
   if(req.method==='GET'&&route==='/observation/status')return reply(res,200,controller.status());
   if(req.method!=='POST'||!['/observation/start','/observation/stop','/events'].includes(route))return reply(res,404,{error:'observation_only'});
   if(!String(req.headers['content-type']).startsWith('application/json'))return reply(res,415,{error:'json_required'});
   let bytes=0,text='';for await(const chunk of req){bytes+=chunk.length;if(bytes>512000)throw new Error('payload_limit');text+=chunk;}
   let input;try{input=JSON.parse(text);}catch{throw new Error('invalid_json');}
   if(route==='/observation/start')return reply(res,200,controller.start(input));
   if(route==='/observation/stop')return reply(res,200,controller.stop('user_or_context_stop'));
   return reply(res,200,controller.accept(input));
  }catch{reply(res,400,{error:'observation_rejected'});}
 });
 const cleanup=()=>{ready=false;controller?.stop('shutdown');source?.close();db?.close();source=db=null;lease.release();};
 server.on('close',cleanup);
 server.on('error',()=>{cleanup();process.stdin.pause();console.error('observer_bind_failed');process.exitCode=1;});
 const shutdown=()=>{controller?.stop('shutdown');server.close();server.closeAllConnections();process.stdin.pause();};
 process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 process.stdin.on('data',chunk=>{if(String(chunk).trim()==='stop')shutdown();});process.stdin.on('end',shutdown);process.stdin.resume();
 server.listen(Number(env.BONO_PORT||47831),'127.0.0.1',()=>{
  try{
   source=new DatabaseSync(sourcePath,{readOnly:true});source.prepare('SELECT court_file_no,uyap_birim_id,uyap_dosya_id FROM cases LIMIT 0').all();
   fs.mkdirSync(path.dirname(evidencePath),{recursive:true});
   const fd=fs.openSync(evidencePath,'wx');fs.closeSync(fd);db=new DatabaseSync(evidencePath);
   db.exec('CREATE TABLE uyap_observation_events(event_id TEXT PRIMARY KEY,captured_at TEXT NOT NULL,event_json TEXT NOT NULL)');
   controller=new ObservationController({db,buildId:env.BONO_OBSERVATION_BUILD_ID,caseReader:id=>source.prepare('SELECT court_file_no,uyap_birim_id,uyap_dosya_id FROM cases WHERE id=?').get(Number(id))});ready=true;
  }catch{cleanup();shutdown();console.error('observer_initialization_failed');process.exitCode=1;}
 });
 return {server,get controller(){return controller;}};
}
module.exports={start};
