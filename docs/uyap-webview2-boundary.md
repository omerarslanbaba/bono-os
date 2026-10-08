# WebView2 ↔ UYAP Core boundary

The WebView2 desktop project is a presentation shell only. It opens the existing BONO Core origin at `http://127.0.0.1:47831/`.

## WebView2 must not
- navigate to UYAP as an authenticated browser;
- host or replace the BONO Chrome extension;
- reuse/copy Chrome UYAP cookies or session storage;
- execute UYAP requests directly;
- become a query/download executor.

Chrome + the BONO extension remain the only UYAP execution environment. WebView2 calls localhost BONO Core APIs and displays Core state.

## Safe web actions
- Global **Tüm Dosya ve Evrak Listelerini Sorgula**: discovery + document-list metadata only; no PDF/UDF queue.
- Per-case **Evrak Listesini Yenile**: one document-list sync only.
- Per-case **Eksik Evrakları Kuyruğa Ekle**: explicit user confirmation, max 200 active queued/running documents per case, and does not clear manual pause.
- **İndirmeleri Devam Ettir**: separate explicit confirmation; only this web action may clear manual download pause.
- **İndirmeleri Duraklat**: immediate safe pause.

## Core invariants
- document.list never calls enqueuePendingDownloads().
- global discovery/archive sync never creates PDF/UDF commands.
- batch queueing never calls setManualDownloadPause(false).
- backend requires explicit confirmation for batch queue, single-document queue and resume.
- per-case 200 limit is enforced in Core, not trusted to UI.
- WebView2 profile remains separate from Chrome.
