const uyap=require('../bridge/uyap');
const db=require('../bridge/db');

function setMode(mode){
  db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES('uyap_integration_mode',?,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')`).run(mode);
}
function clean(){
  db.prepare("DELETE FROM uyap_command_queue WHERE endpoint_key='__rate_test__'").run();
  db.prepare("DELETE FROM uyap_endpoints WHERE endpoint_key='__rate_test__'").run();
  db.prepare("UPDATE uyap_rate_state SET last_dispatch_ms=0,next_allowed_ms=0,circuit_open_until_ms=0,consecutive_failures=0,last_status=NULL,state='ready' WHERE id=1").run();
}

(async()=>{
  clean();
  setMode('official_api');
  uyap.resume();
  uyap.approveEndpoint({endpointKey:'__rate_test__',method:'GET',host:'avukat.uyap.gov.tr',path:'/__bono_local_test__',purpose:'local rate test',minIntervalMs:2200});
  const a=uyap.enqueue({commandType:'download_document',endpointKey:'__rate_test__',payload:{fileName:'a.udf'}});
  const b=uyap.enqueue({commandType:'download_document',endpointKey:'__rate_test__',payload:{fileName:'b.udf'}});
  const first=uyap.claimNext('avukat.uyap.gov.tr');
  const immediate=uyap.claimNext('avukat.uyap.gov.tr');
  if(!first || first.hardMinIntervalMs<2200) throw new Error('Minimum aralık uygulanmadı');
  if(!immediate?.wait || immediate.retryAfterMs<2000) throw new Error('İkinci komut erken çıktı');
  uyap.reportResult(a,{ok:true,status:200,contentType:'application/octet-stream',size:10,fileName:'a.udf'});
  await new Promise(r=>setTimeout(r,2750));
  const second=uyap.claimNext('avukat.uyap.gov.tr');
  if(!second || second.id!==b) throw new Error('İkinci komut bekleme sonrası çıkmadı');
  uyap.reportResult(b,{ok:false,status:429,error:'local simulated rate limit'});
  const state=uyap.rateState();
  if(state.state!=='rate_limited' || state.circuit_open_until_ms<=Date.now()) throw new Error('429 devre kesici çalışmadı');
  console.log(JSON.stringify({
    ok:true,
    hardMinIntervalMs:first.hardMinIntervalMs,
    immediateRetryAfterMs:immediate.retryAfterMs,
    circuitState:state.state
  }));
})().finally(()=>{
  clean();
  setMode('observe_only');
});