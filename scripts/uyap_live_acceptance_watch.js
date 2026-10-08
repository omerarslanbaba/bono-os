const {DatabaseSync}=require("node:sqlite");
const path=require("node:path");

function arg(name,def){
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):def;
}
const durationSec=Math.max(30,Number(arg("duration","300"))||300);
const intervalSec=Math.max(2,Number(arg("interval","15"))||15);
const dbPath=process.env.BONO_DB_PATH||path.join(__dirname,"..","data","bono.db");
const db=new DatabaseSync(dbPath,{readOnly:true});

function setting(key,def=""){
  const r=db.prepare("select value from app_settings where key=?").get(key);
  return r?r.value:def;
}
function one(sql,...args){return db.prepare(sql).get(...args)}
function snapshot(){
  return {
    at:new Date().toISOString(),
    sessionState:setting("uyap_session_state",""),
    sessionReason:setting("uyap_session_reason",""),
    manualDownloadPaused:setting("uyap_manual_download_pause","0")==="1",
    documentDownloadState:setting("uyap_document_download_state",""),
    documentDownloadReason:setting("uyap_document_download_reason",""),
    cbsCompleted:Number(one("select count(*) n from uyap_command_queue where endpoint_key='cbs.search' and status='completed'").n||0),
    cbsQueued:Number(one("select count(*) n from uyap_command_queue where endpoint_key='cbs.search' and status='queued'").n||0),
    queryCompleted:Number(one("select count(*) n from uyap_command_queue where endpoint_key!='document.pdf' and status='completed'").n||0),
    queryQueued:Number(one("select count(*) n from uyap_command_queue where endpoint_key!='document.pdf' and status='queued'").n||0),
    queryRunning:Number(one("select count(*) n from uyap_command_queue where endpoint_key!='document.pdf' and status='running'").n||0),
    queryLastDispatch:one("select max(dispatched_at) t from uyap_command_queue where endpoint_key!='document.pdf'").t||null,
    queryLastComplete:one("select max(finished_at) t from uyap_command_queue where endpoint_key!='document.pdf' and status='completed'").t||null,
    pdfCompleted:Number(one("select count(*) n from uyap_command_queue where endpoint_key='document.pdf' and status='completed'").n||0),
    pdfQueued:Number(one("select count(*) n from uyap_command_queue where endpoint_key='document.pdf' and status='queued'").n||0),
    pdfRunning:Number(one("select count(*) n from uyap_command_queue where endpoint_key='document.pdf' and status='running'").n||0),
    pdfLastDispatch:one("select max(dispatched_at) t from uyap_command_queue where endpoint_key='document.pdf'").t||null,
    pdfLastComplete:one("select max(finished_at) t from uyap_command_queue where endpoint_key='document.pdf' and status='completed'").t||null,
    rate:one("select last_status,state,updated_at from uyap_rate_state where id=1")
  };
}
function fail(errors,msg){if(msg&&!errors.includes(msg))errors.push(msg)}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

(async()=>{
  const baseline=snapshot();
  const errors=[];
  if(baseline.sessionState!=="ready")fail(errors,"acceptance must start after genuine authenticated session is ready");
  if(!baseline.manualDownloadPaused)fail(errors,"manual download pause is not active at baseline");
  if(baseline.pdfRunning!==0)fail(errors,"PDF command is already running at baseline");
  if(baseline.queryRunning>1)fail(errors,"more than one query is running at baseline");
  if(errors.length){
    console.log(JSON.stringify({ok:false,phase:"baseline",errors,baseline},null,2));
    process.exitCode=2; return;
  }

  console.log(JSON.stringify({phase:"baseline",durationSec,intervalSec,baseline}));
  const deadline=Date.now()+durationSec*1000;
  let maxQueryRunning=baseline.queryRunning;
  let samples=0;
  let last=snapshot();

  while(Date.now()<deadline){
    await sleep(Math.min(intervalSec*1000,Math.max(1,deadline-Date.now())));
    const s=snapshot(); samples++;
    maxQueryRunning=Math.max(maxQueryRunning,s.queryRunning);
    if(!s.manualDownloadPaused)fail(errors,"manual download pause cleared during acceptance");
    if(s.pdfRunning!==0)fail(errors,"PDF command became running during manual pause");
    if(s.pdfLastDispatch!==baseline.pdfLastDispatch)fail(errors,"PDF dispatch timestamp changed during manual pause");
    if(s.pdfQueued!==baseline.pdfQueued)fail(errors,"PDF queued count changed while no manual batch was started");
    if(s.queryRunning>1)fail(errors,"more than one query command is running concurrently");
    if(s.sessionState!=="ready")fail(errors,"UYAP session left ready state during acceptance");
    if(Number(s.rate?.last_status||0)===401||Number(s.rate?.last_status||0)===403)fail(errors,"401/403 observed during acceptance");
    last=s;
    console.log(JSON.stringify({phase:"sample",sample:samples,state:s}));
    if(errors.length)break;
  }

  const queryDispatchAdvanced=String(last.queryLastDispatch||"")!==String(baseline.queryLastDispatch||"");
  const cbsAdvanced=last.cbsCompleted>baseline.cbsCompleted;
  if(!queryDispatchAdvanced)fail(errors,"query dispatch did not advance");
  if(!cbsAdvanced)fail(errors,"CBS completed count did not advance");

  const result={
    ok:errors.length===0,
    errors,
    durationSec,
    intervalSec,
    samples,
    maxQueryRunning,
    queryDispatchAdvanced,
    cbsAdvanced,
    pdfDispatchUnchanged:last.pdfLastDispatch===baseline.pdfLastDispatch,
    pdfQueueUnchanged:last.pdfQueued===baseline.pdfQueued,
    baseline,
    final:last
  };
  console.log(JSON.stringify({phase:"result",...result},null,2));
  if(!result.ok)process.exitCode=1;
})().catch(e=>{
  console.error(e);
  process.exitCode=1;
});
