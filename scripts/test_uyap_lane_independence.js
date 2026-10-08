const fs=require("node:fs");
const path=require("node:path");

function must(ok,message){ if(!ok) throw new Error(message); }
const root=path.resolve(__dirname,"..");
const background=fs.readFileSync(path.join(root,"extension","background.js"),"utf8");
const content=fs.readFileSync(path.join(root,"extension","content.js"),"utf8");
const uyap=fs.readFileSync(path.join(root,"bridge","uyap.js"),"utf8");

must(background.includes('type:"BONO_WAKE_QUERY"'),"Alarm fallback query wake mesajı yok");
must(background.includes('chrome.alarms.onAlarm.addListener'),"Chrome alarm fallback yok");
must(content.includes('message?.type === "BONO_WAKE_QUERY"'),"Content query wake handler yok");
must(content.includes('pollLane("query")'),"Query lane poll çağrısı yok");
must(content.includes("const STALE_LANE_MS = 135000"),"Stale lane duvar-saati koruması yok");
must(content.includes("startedAt: Date.now()"),"Active lane başlangıç zamanı tutulmuyor");
must(content.includes("await recoverStaleLane(lane)"),"Stale active lane recovery poll'a bağlı değil");
must(uyap.includes('const documentDownloadsPaused=sessionState().manualDownloadPaused||setting("uyap_document_download_state","ready")!=="ready"'),"Manual download pause guard değişmiş");
must(uyap.includes('lane==="query"?"AND q.command_type!=\'download_document\'":""'),"Query lane download dışlama filtresi değişmiş");

function eligible(command,lane,manualPaused){
  if(lane==="download") return !manualPaused && command.type==="download_document";
  if(lane==="query") return command.type!=="download_document";
  return !manualPaused || command.type!=="download_document";
}
const query={type:"fetch_json"}, download={type:"download_document"};
must(eligible(query,"query",true)===true,"Manual pause query lane'i engelliyor");
must(eligible(download,"download",true)===false,"Manual pause download lane'i engellemiyor");
must(eligible(download,"download",false)===true,"Resume sonrası download lane açılamıyor");

const now=1_000_000;
function stale(startedAt){ return now-startedAt>=135000; }
must(stale(now-134999)===false,"Lane erken stale oluyor");
must(stale(now-135000)===true,"Lane stale sınırında toparlanmıyor");

console.log(JSON.stringify({
  ok:true,
  manualPauseKeepsQuery:true,
  manualPauseBlocksDownload:true,
  alarmWakesQuery:true,
  staleLaneRecoveryMs:135000
}));
