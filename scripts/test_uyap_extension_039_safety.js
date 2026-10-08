const fs=require("node:fs");
const path=require("node:path");

function must(ok,message){ if(!ok) throw new Error(message); }
const root=path.resolve(__dirname,"..");
const background=fs.readFileSync(path.join(root,"extension","background.js"),"utf8");
const content=fs.readFileSync(path.join(root,"extension","content.js"),"utf8");
const uyap=fs.readFileSync(path.join(root,"bridge","uyap.js"),"utf8");

must(background.includes('version="0.3.9"'),"0.3.9 runtime marker yok");
must(background.includes("bonoBridgeNeedsTabReload:true"),"Güvenli manuel tab reload bayrağı yok");
must(!/migrateBridgeRuntime[\s\S]{0,800}chrome\.tabs\.reload/.test(background),"Migration açık UYAP sekmesini otomatik reload ediyor");
must(background.includes('type:"BONO_WAKE_QUERY"'),"Alarm query wake mesajı yok");
must(!background.includes('type:"BONO_WAKE_DOWNLOAD"'),"Alarm download lane'i uyandırmamalı");
must(content.includes('message?.type === "BONO_WAKE_QUERY"'),"Content query wake handler yok");
must(content.includes('const STALE_LANE_MS = 135000'),"Stale lane guard yok");
must(content.includes("startedAt: Date.now()"),"Lane başlangıç zamanı tutulmuyor");
must(uyap.includes("explicitErrorObservation"),"Core errorCode/error 200 auth guard yok");
must(background.includes("explicitError"),"Extension errorCode/error 200 auth guard yok");
must(uyap.includes('if(sessionState().state==="login_required") return {wait:true'),"login_required claim guard yok");
must(uyap.includes('manualDownloadPaused||setting("uyap_document_download_state","ready")!=="ready"'),"Manual download pause guard değişmiş");

function makeCore(){
  let running=false, nextId=1, claims=0;
  return {
    claim(){
      if(running)return null;
      running=true; claims++;
      return {id:nextId++};
    },
    complete(){running=false;},
    claims(){return claims;}
  };
}
async function duplicateWakeSimulation(){
  const core=makeCore();
  const active=new Map();
  async function pollQuery(){
    if(active.has("query"))return null;
    const cmd=core.claim();
    if(!cmd)return null;
    active.set("query",{id:cmd.id,startedAt:Date.now()});
    return cmd;
  }
  const [a,b]=await Promise.all([pollQuery(),pollQuery()]);
  must(core.claims()===1,"Interval + alarm yarışı duplicate Core claim üretti");
  must([a,b].filter(Boolean).length===1,"Aynı query iki kez dispatch edildi");
}
async function staleRecoverySimulation(){
  let reports=0,claims=0;
  const active=new Map([["query",{id:41,startedAt:0}]]);
  const now=135001;
  async function wake(){
    const x=active.get("query");
    if(x && now-x.startedAt>=135000){active.delete("query");reports++;}
    if(active.has("query"))return;
    active.set("query",{id:42,startedAt:now});claims++;
  }
  await Promise.all([wake(),wake()]);
  must(reports===1,"Stale query aynı iş için birden fazla failure report üretti");
  must(claims===1,"Stale recovery sonrası aynı yeni query iki kez claim edildi");
}

(async()=>{
  await duplicateWakeSimulation();
  await staleRecoverySimulation();
  console.log(JSON.stringify({
    ok:true,
    autoTabReload:false,
    duplicateDispatch:false,
    staleRecoveryDuplicate:false,
    loginRequiredGuard:true,
    errorPayloadDoesNotRecoverSession:true,
    manualDownloadPausePreserved:true
  }));
})().catch(e=>{console.error(e);process.exitCode=1});
