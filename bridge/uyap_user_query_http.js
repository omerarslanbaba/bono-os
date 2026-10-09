'use strict';
module.exports=async function handle(req,res,{path,origin,service,json,readBody}){
 if(req.method==='POST'&&path.startsWith('/api/uyap/session-check/')){
  const action=path.slice('/api/uyap/session-check/'.length);
  if(!['start','claim','result'].includes(action)){json(res,404,{error:'unknown_session_check_action'});return true;}
  if(action==='start'&&(req.headers['x-bono-user-action']!=='1'||(req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')){json(res,403,{error:'explicit_same_origin_user_action_required'});return true;}
  if(action!=='start'&&(req.headers['x-bono-bridge']!=='1'||(req.headers.origin&&!/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin)))){json(res,403,{error:'extension_bridge_required'});return true;}
  try{const b=await readBody(req);json(res,200,action==='start'?service.sessionCheck.begin(b.requestKey):service.sessionCheck[action](b));}catch{json(res,409,{error:'session_check_rejected'});}return true;
 }
 const m=path.match(/^\/api\/uyap\/cases\/(\d+)\/(query|query-history|query-support|sync-documents|download-options|approved-downloads)$/);
 if(req.method==='GET'&&path==='/api/uyap/query-history'){const u=new URL(req.url,origin);json(res,200,service.history(null,{beforeId:u.searchParams.get('before'),limit:u.searchParams.get('limit')}));return true;}
 if(req.method==='GET'&&path==='/api/uyap/user-query-state'){json(res,200,service.pending());return true;}
 if(m&&req.method==='GET'&&m[2]==='query-history'){json(res,200,service.history(Number(m[1])));return true;}
 if(m&&req.method==='GET'&&m[2]==='query-support'){json(res,200,service.status(Number(m[1])));return true;}
 if(m&&req.method==='GET'&&m[2]==='download-options'){try{json(res,200,service.downloadOptions(Number(m[1])));}catch(e){json(res,409,{error:e.message});}return true;}
 if((m&&req.method==='POST'&&['query','sync-documents','approved-downloads'].includes(m[2]))||(req.method==='POST'&&path==='/api/uyap/download-pause')){
  if(req.headers['x-bono-user-action']!=='1'||(req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site'){json(res,403,{error:'explicit_same_origin_user_action_required'});return true;}
  try{const body=await readBody(req);if(path==='/api/uyap/download-pause'){if(body.confirmed!==true||typeof body.paused!=='boolean')throw Error('separate_download_pause_consent_required');json(res,200,service.downloadPause(body.paused));return true;}
   const out=m[2]==='approved-downloads'?service.beginDownloads(Number(m[1]),body):service.begin(Number(m[1]),body);json(res,out.state==='cache_hit'?200:202,{ok:true,id:out.commandId,...out});}catch(e){json(res,409,{ok:false,error:e.message});}return true;
 }
 // Diagnostic heartbeat cannot enqueue work; server validates its fixed scalar schema.
 if(req.method==='POST'&&path==='/api/uyap/bridge-state')return false;
 // Legacy producers cannot create an executable query or clear a download pause.
 if(req.method==='POST'&&path.startsWith('/api/uyap/')&&!/^\/api\/uyap\/commands\/\d+\/result$/.test(path)){
  json(res,409,{error:'unsupported_or_separate_user_consent_required'});return true;
 }
 return false;
};
