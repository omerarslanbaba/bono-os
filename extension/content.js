(() => {
  if (window.__BONO_CONTENT_BRIDGE__) return;
  window.__BONO_CONTENT_BRIDGE__ = true;

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
        probe.onload = () => probe.remove();
        (document.documentElement || document.head || document.body).appendChild(probe);
      };
      (document.documentElement || document.head || document.body).appendChild(script);
    } catch {}
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
    if (runtimeAlive()) chrome.runtime.onMessage.addListener(message => {
      if (message?.type === "BONO_EXECUTE") dispatchCommand(message.command);
      if (message?.type === "BONO_AUTH_PROBE") window.postMessage({channel:"BONO_UYAP_CONTENT",type:"auth_probe"},"*");
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
      sendCapture("probe_ready", msg.data);
      return;
    }

    if (msg.type === "command_result") {
      postResult(msg.data);
    }
  });

  async function pollLane(lane) {
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
    sendCapture("page_seen", { title: document.title, path: location.pathname, host: location.hostname });
  });

  // Poll'lar yalnız localhost'a gider. UYAP'a gerçek istek aralığını bridge lane limiter'ları zorlar.
  setInterval(() => pollLane("download"), 700);
  setTimeout(() => setInterval(() => pollLane("query"), 900), 350);
})();