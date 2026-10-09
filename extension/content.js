(() => {
  if (window.__BONO_CONTENT_BRIDGE__) return;
  window.__BONO_CONTENT_BRIDGE__ = true;
  const config=typeof BONO_RUNTIME_CONFIG==='object'?BONO_RUNTIME_CONFIG:{mode:'observation_only',buildId:'missing'};
  const observationOnly=config.mode==='observation_only';
  const documentId=crypto.randomUUID();
  let probeStatus={ready:false,error:'not_loaded',buildId:config.buildId,documentId,probeVersion:2};

  const LOCAL = "http://127.0.0.1:47831";
  const active = new Map();
  const laneOf = command => command?.lane || (command?.commandType === "download_document" ? "download" : "query");

  const runtimeAlive = () => {
    try { return !!(chrome?.runtime?.id); } catch { return false; }
  };

  const sendCapture = (kind, data) => {
    if (!runtimeAlive()) return Promise.resolve();
    try {
      return chrome.runtime.sendMessage({
        type: "BONO_CAPTURE",
        payload: { kind, data }
      }).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  };

  function injectProbe() {
    if (!runtimeAlive()) return;
    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("observation_contracts.js");
      script.async = false;
      script.onload = () => {
        script.remove();
        const probe = document.createElement("script");
        probe.src = chrome.runtime.getURL("page_probe.js");
        probe.dataset.bonoMode=config.mode;
        probe.dataset.bonoBuild=config.buildId;
        probe.dataset.bonoDocument=documentId;
        probe.onerror=()=>{probeStatus={...probeStatus,ready:false,error:'probe_load_failed'};probe.remove();};
        probe.onload = () => probe.remove();
        const helper=document.createElement("script");
        helper.src=chrome.runtime.getURL("controlled_probe.js");
        helper.onload=()=>{helper.remove();(document.documentElement || document.head || document.body).appendChild(probe);};
        helper.onerror=()=>{probeStatus={...probeStatus,ready:false,error:"helper_load_failed"};helper.remove();};
        (document.documentElement || document.head || document.body).appendChild(helper);
      };
      script.onerror=()=>{probeStatus={...probeStatus,ready:false,error:'catalog_load_failed'};script.remove();};
      (document.documentElement || document.head || document.body).appendChild(script);
    } catch {probeStatus={...probeStatus,ready:false,error:'injection_failed'};}
  }

  async function postResult(data) {
    if (!data?.id) return;
    let slot = null;
    for (const [lane, x] of active.entries()) {
      if (Number(x?.id) === Number(data.id)) { slot = lane; break; }
    }
    if (slot) {
      const x = active.get(slot);
      if (x?.timer) clearTimeout(x.timer);
      active.delete(slot);
    }
    try {
      await chrome.runtime.sendMessage({ type: "BONO_RESULT", data });
    } catch {}
  }

  function dispatchCommand(command, laneHint = null) {
    if(observationOnly||!probeStatus.ready)return false;
    if (!command?.id) return false;
    const lane = laneHint || laneOf(command);
    if (active.has(lane)) return false;
    const timer = setTimeout(() => {
      const x = active.get(lane);
      if (x && Number(x.id) === Number(command.id)) {
        active.delete(lane);
        postResult({ id: command.id, ok: false, status: 0, error: "Komut zaman aşımına uğradı" });
      }
    }, 120000);
    active.set(lane, { id: command.id, timer });
    window.postMessage({ channel: "BONO_UYAP_CONTENT", type: "execute_command", command }, "*");
    return true;
  }

  try {
    if (runtimeAlive()) chrome.runtime.onMessage.addListener((message,sender,reply) => {
      if(message.type==='BONO_OBSERVATION_STATUS'){reply(probeStatus);return;}
      if(message.type==='BONO_OBSERVATION_ARM'){
        if(!observationOnly||!probeStatus.ready||message.session.documentId!==documentId){reply({ok:false});return;}
        window.postMessage({channel:'BONO_UYAP_CONTENT',type:'observation_arm',session:message.session},'*');reply({ok:true});return;
      }
      if(message.type==='BONO_OBSERVATION_DISARM'){window.postMessage({channel:'BONO_UYAP_CONTENT',type:'observation_disarm'},'*');reply({ok:true});return;}
      if(observationOnly)return;
      if (message?.type === "BONO_EXECUTE") dispatchCommand(message.command);
      if (message?.type === "BONO_AUTH_PROBE" && probeStatus.ready) window.postMessage({channel:"BONO_UYAP_CONTENT",type:"auth_probe"},"*");
    });
  } catch {}

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.channel !== "BONO_UYAP_PAGE") return;

    if (msg.type === "network_observation") {
      sendCapture("network_observation", msg.data);
      return;
    }

    if (msg.type === "probe_ready") {
      probeStatus={...probeStatus,ready:msg.data?.probeVersion===2&&msg.data?.buildId===config.buildId&&msg.data?.documentId===documentId,error:null};
      if(observationOnly)return;
      sendCapture("probe_ready", msg.data);
      return;
    }
    if(msg.type==='probe_conflict'){probeStatus={...probeStatus,ready:false,error:'old_probe_present'};return;}
    if(msg.type==='observation_stopped'){sendCapture('observation_stopped',msg.data);return;}

    if (msg.type === "command_result") {
      postResult(msg.data);
    }
  });

  async function pollLane(lane) {
    if(observationOnly||!probeStatus.ready)return;
    if (active.has(lane)) return;
    try {
      const reply = await chrome.runtime.sendMessage({ type: "BONO_POLL", host: location.hostname, lane });
      const command = reply?.command;
      if (!reply?.ok || !command?.id) return;
      dispatchCommand(command, lane);
    } catch {}
  }

  injectProbe();

  window.addEventListener("load", () => {
    if(observationOnly)return;
    sendCapture("page_seen", { title: document.title, path: location.pathname, host: location.hostname });
  });

  // Poll'lar yalnız localhost'a gider. UYAP'a gerçek istek aralığını bridge lane limiter'ları zorlar.
  if(!observationOnly){
    setInterval(() => pollLane("download"), 700);
    setTimeout(() => setInterval(() => pollLane("query"), 900), 350);
  }
})();
