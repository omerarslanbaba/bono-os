(() => {
  if (window.__BONO_UYAP_PROBE__) return;
  window.__BONO_UYAP_PROBE__ = true;

  const CHANNEL = "BONO_UYAP_PAGE";
  const MAX_JSON_SAMPLE = 250000;

  function isUyapUrl(raw) {
    try {
      const u = new URL(raw, location.href);
      return u.hostname === "uyap.gov.tr" || u.hostname.endsWith(".uyap.gov.tr");
    } catch {
      return false;
    }
  }

  function post(type, data) {
    window.postMessage({ channel: CHANNEL, type, data }, "*");
  }

  function safeKeys(value) {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) {
      const first = value.find(x => x && typeof x === "object");
      if (!first) return ["[]"];
      return ["[]", ...Object.keys(first).slice(0, 40)];
    }
    return Object.keys(value).slice(0, 50);
  }

  const READ_ONLY_PATHS = new Set([
    "/list_dosya_evraklar.ajx","/listDosyaEvraklarPageTotal.ajx",
    "/getDocViewerParameters.ajx","/view_document_brd.uyap",
    "/dosyaAyrintiBilgileri_brd.ajx","/dosya_taraf_bilgileri_brd.ajx",
    "/search_phrase_detayli.ajx","/yargiBirimleriSorgula_brd.ajx",
    "/avukat_mahkemeleri_sorgula.ajx","/avukat_durusma_sorgula_brd.ajx",
    "/illeri_getirJSON.ajx","/cbs_birim_sorgula.ajx","/avukat_dosya_sorgula_cbs_brd.ajx"
  ]);
  const OBSERVE_REQUEST_PATHS = new Set([
    ...READ_ONLY_PATHS,
    "/getDosyaAramaParameters.ajx",
    "/avukat_mahkemeleri_sorgula.ajx",
    "/yargiBirimleriSorgula_brd.ajx",
    "/search_phrase_detayli.ajx"
  ]);
  const SECRET_KEY = /token|auth|cookie|session|csrf|xsrf|password|passwd|sifre|şifre|pin|imza|signature|captcha|secret|credential/i;
  function scrub(value, depth = 0) {
    if (depth > 3 || value == null) return value == null ? null : undefined;
    if (Array.isArray(value)) return value.slice(0, 20).map(v => scrub(v, depth + 1)).filter(v => v !== undefined);
    if (typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value).slice(0, 60)) {
        if (SECRET_KEY.test(k)) { out[k] = "[REDACTED]"; continue; }
        const x = scrub(v, depth + 1); if (x !== undefined) out[k] = x;
      }
      return out;
    }
    if (["string","number","boolean"].includes(typeof value)) return typeof value === "string" ? value.slice(0, 500) : value;
  }
  function observedHeaders(headers = {}) {
    const out = {};
    const allowed = new Set(["accept","content-type","x-requested-with"]);
    for (const [k,v] of Object.entries(headers || {})) if (allowed.has(String(k).toLowerCase())) out[k] = String(v);
    return out;
  }
  function requestShape(rawUrl, body, headers = {}) {
    try {
      const u = new URL(rawUrl, location.href);
      if (!OBSERVE_REQUEST_PATHS.has(u.pathname)) return null;
      const query = {}; u.searchParams.forEach((v,k) => query[k] = v);
      let parsed = null;
      if (body instanceof URLSearchParams) parsed = Object.fromEntries(body.entries());
      else if (typeof FormData !== "undefined" && body instanceof FormData) {
        parsed = {}; for (const [k,v] of body.entries()) parsed[k] = typeof v === "string" ? v : "[binary]";
      } else if (typeof body === "string" && body.length <= 20000) {
        try { parsed = JSON.parse(body); }
        catch { try { parsed = Object.fromEntries(new URLSearchParams(body).entries()); } catch {} }
      }
      return scrub({query, body: parsed, headers: observedHeaders(headers)});
    } catch { return null; }
  }
  function responseSummary(data) {
    if (!data || typeof data !== "object") return null;
    return scrub({
      type: Array.isArray(data) ? "array" : "object",
      length: Array.isArray(data) ? data.length : undefined,
      tumEvraklar: Array.isArray(data.tumEvraklar) ? data.tumEvraklar.length : (data.tumEvraklar == null ? null : typeof data.tumEvraklar),
      son20Evrak: Array.isArray(data.son20Evrak) ? data.son20Evrak.length : (data.son20Evrak == null ? null : typeof data.son20Evrak),
      pageTotal: data.pageTotal,
      status: data.status
    });
  }

  async function observeResponse(method, url, response, startedAt, request = null) {
    try {
      if (!isUyapUrl(url)) return;
      const contentType = response.headers.get("content-type") || "";
      const len = Number(response.headers.get("content-length") || 0);
      let sampleKeys = [], responseSummaryData = null;
      if (/json/i.test(contentType) && (!len || len <= MAX_JSON_SAMPLE)) {
        try {
          const clone = response.clone();
          const data = await clone.json();
          sampleKeys = safeKeys(data);
          responseSummaryData = responseSummary(data);
        } catch {}
      }
      post("network_observation", {
        transport: "fetch",
        method: String(method || "GET").toUpperCase(),
        url: new URL(url, location.href).href,
        status: response.status,
        contentType,
        durationMs: Math.round(performance.now() - startedAt),
        sampleKeys,
        request,
        responseSummary: responseSummaryData
      });
    } catch {}
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function(input, init = {}) {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = init?.method || (typeof input !== "string" ? input?.method : null) || "GET";
    const startedAt = performance.now();
    const request = requestShape(url, init?.body, init?.headers || {});
    try {
      const response = await originalFetch(input, init);
      observeResponse(method, url, response, startedAt, request);
      return response;
    } catch (e) {
      if (isUyapUrl(url)) {
        post("network_observation", {
          transport: "fetch",
          method: String(method).toUpperCase(),
          url: new URL(url, location.href).href,
          status: 0,
          contentType: "",
          durationMs: Math.round(performance.now() - startedAt),
          request,
          error: String(e?.message || e)
        });
      }
      throw e;
    }
  };

  const XHR = window.XMLHttpRequest;
  const originalOpen = XHR.prototype.open;
  const originalSend = XHR.prototype.send;
  const originalSetRequestHeader = XHR.prototype.setRequestHeader;
  XHR.prototype.open = function(method, url, ...rest) {
    this.__bonoMethod = method;
    this.__bonoUrl = url;
    this.__bonoHeaders = {};
    return originalOpen.call(this, method, url, ...rest);
  };
  XHR.prototype.setRequestHeader = function(name, value) {
    const n = String(name || "").toLowerCase();
    if (["accept","content-type","x-requested-with"].includes(n)) this.__bonoHeaders[name] = String(value);
    return originalSetRequestHeader.call(this, name, value);
  };
  XHR.prototype.send = function(body) {
    const startedAt = performance.now();
    const request = requestShape(this.__bonoUrl, body, this.__bonoHeaders || {});
    const done = () => {
      try {
        if (!isUyapUrl(this.__bonoUrl)) return;
        const contentType = this.getResponseHeader("content-type") || "";
        let sampleKeys = [], responseSummaryData = null;
        if (/json/i.test(contentType)) {
          try {
            const data = this.responseType === "json"
              ? this.response
              : (typeof this.responseText === "string" && this.responseText.length <= MAX_JSON_SAMPLE
                ? JSON.parse(this.responseText)
                : null);
            sampleKeys = safeKeys(data);
            responseSummaryData = responseSummary(data);
          } catch {}
        }
        post("network_observation", {
          transport: "xhr",
          method: String(this.__bonoMethod || "GET").toUpperCase(),
          url: new URL(this.__bonoUrl, location.href).href,
          status: Number(this.status || 0),
          contentType,
          durationMs: Math.round(performance.now() - startedAt),
          sampleKeys,
          request,
          responseSummary: responseSummaryData
        });
      } catch {}
    };
    this.addEventListener("loadend", done, { once: true });
    return originalSend.call(this, body);
  };

  function cleanHeaders(headers = {}) {
    const allowed = new Set(["accept", "content-type", "x-requested-with"]);
    const out = {};
    for (const [k, v] of Object.entries(headers || {})) {
      if (allowed.has(String(k).toLowerCase())) out[k] = String(v);
    }
    return out;
  }

  function inferFileName(response, fallback) {
    const cd = response.headers.get("content-disposition") || "";
    let m = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (m) {
      try { return decodeURIComponent(m[1].replace(/["']/g, "")); } catch {}
    }
    m = cd.match(/filename="?([^";]+)"?/i);
    if (m) return m[1];
    return fallback || ("UYAP_Evrak_" + Date.now());
  }

  async function executeCommand(command) {
    const baseResult = { id: command.id, ok: false, status: 0 };
    try {
      if (!command || !command.id) throw new Error("Geçersiz komut");
      if (command.host !== location.hostname) throw new Error("Komut başka UYAP hostu için");
      if (!String(command.path || "").startsWith("/")) throw new Error("Geçersiz endpoint path");

      const endpoint = new URL(command.path, location.origin);
      const method = String(command.method || "GET").toUpperCase();
      const expectedMethod = endpoint.pathname === "/view_document_brd.uyap" ? "GET" : "POST";
      if (!READ_ONLY_PATHS.has(endpoint.pathname) || method !== expectedMethod)
        throw new Error("Komut salt-okuma UYAP izin listesinde değil");
      const query = command.payload?.query || {};
      for (const [k, v] of Object.entries(query)) {
        if (Array.isArray(v)) v.forEach(x => endpoint.searchParams.append(k, String(x)));
        else if (v !== undefined && v !== null) endpoint.searchParams.set(k, String(v));
      }

      const init = {
        method: command.method || "GET",
        credentials: "include",
        headers: cleanHeaders(command.payload?.headers || {})
      };

      if (!["GET", "HEAD"].includes(String(init.method).toUpperCase()) && command.payload?.body !== undefined) {
        if (typeof command.payload.body === "string") {
          init.body = command.payload.body;
        } else {
          if (!Object.keys(init.headers).some(k => k.toLowerCase() === "content-type")) {
            init.headers["Content-Type"] = "application/json";
          }
          init.body = JSON.stringify(command.payload.body);
        }
      }

      let response;
      if (command.commandType === "download_document") {
        const prepUrl = new URL("/getDocViewerParameters.ajx", location.origin);
        const prep = await originalFetch(prepUrl.href, {
          method: "POST",
          credentials: "include",
          headers: {"Accept":"application/json, text/plain, */*","Content-Type":"application/json"}
        });
        const prepType = prep.headers.get("content-type") || "";
        let prepOk = prep.ok && /json/i.test(prepType);
        if (prepOk) {
          try {
            const prepData = await prep.clone().json();
            prepOk = Object.prototype.hasOwnProperty.call(prepData || {}, "oncelik") && !prepData?.errorCode;
          } catch { prepOk = false; }
        }
        if (!prepOk) {
          post("command_result", {
            ...baseResult,
            ok: false,
            status: prep.status,
            contentType: prepType,
            error: "document_viewer_prepare_failed"
          });
          return;
        }
      }
      response = await originalFetch(endpoint.href, init);
      const contentType = response.headers.get("content-type") || "";

      if (command.commandType === "download_document") {
        const blob = await response.blob();
        const fileName = inferFileName(response, command.payload?.fileName);
        const isHtml = /html/i.test(contentType);
        if (response.ok && !isHtml) {
          const objectUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = objectUrl;
          a.download = fileName.startsWith("BONO_UYAP_") ? fileName : ("BONO_UYAP_" + fileName);
          a.style.display = "none";
          document.documentElement.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        }
        post("command_result", {
          ...baseResult,
          ok: response.ok && !isHtml,
          status: response.status,
          contentType,
          size: blob.size,
          fileName,
          error: isHtml ? "document_viewer_returned_html" : undefined
        });
        return;
      }

      let dataKeys = [], data = null;
      if (/json/i.test(contentType)) {
        try {
          const parsed = await response.clone().json();
          dataKeys = safeKeys(parsed);
          const serialized = JSON.stringify(parsed);
          if (serialized.length <= 1500000) data = parsed;
        } catch {}
      }
      post("command_result", {
        ...baseResult,
        ok: response.ok,
        status: response.status,
        contentType,
        dataKeys,
        data
      });
    } catch (e) {
      post("command_result", {
        ...baseResult,
        error: String(e?.message || e)
      });
    }
  }

  async function authProbe() {
    try {
      const url = new URL("/get_avukat_id.ajx", location.origin);
      const startedAt = performance.now();
      const response = await originalFetch(url.href, {
        method: "POST",
        credentials: "include",
        headers: {"Accept":"application/json, text/plain, */*","Content-Type":"application/json"}
      });
      observeResponse("POST", url.href, response, startedAt, {query:{},body:{},headers:{"Accept":"application/json, text/plain, */*","Content-Type":"application/json"}});
    } catch {}
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.channel !== "BONO_UYAP_CONTENT") return;
    if(msg.type === "execute_command") executeCommand(msg.command);
    if(msg.type === "auth_probe") authProbe();
  });

  post("probe_ready", { host: location.hostname, path: location.pathname });
})();