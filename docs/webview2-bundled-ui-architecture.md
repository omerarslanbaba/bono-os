# BONO OS WebView2 bundled-UI architecture

## Goal

The WebView2 executable must render the `web/` snapshot from the same GitHub build, while all backend/API work continues to use the existing local BONO Core at `http://127.0.0.1:47831`.

The live Core `web/` directory is never replaced by the preview.

## Architecture choice

### Rejected: direct live-Core navigation

Navigating WebView2 to `http://127.0.0.1:47831/` always renders whichever static files the currently running Core has on disk. Rebuilding the EXE cannot change that UI.

### Rejected: virtual host mapping only

WebView2 virtual-host mapping is excellent for local static content, but requests resolved by `SetVirtualHostNameToFolderMapping` do not raise `WebResourceRequested`. The existing web app uses root-relative `/api/...` URLs, so a mapped host would try to resolve those paths as local files. Pointing JavaScript directly at the Core would create cross-origin/CORS behavior and would no longer reproduce the original same-origin web application.

### Selected: isolated loopback static server + API reverse proxy

The packaged application starts a server on `127.0.0.1` with an OS-selected ephemeral port.

That server:

- serves the verified packaged web snapshot;
- proxies only `/api/*` and `/health` to `http://127.0.0.1:47831`;
- never exposes another Core path;
- binds only to loopback;
- disables static asset caching;
- does not start, stop, restart, or modify Core.

WebView2 navigates to that ephemeral loopback origin. Existing root-relative CSS, JavaScript, images, hash routes, and `fetch('/api/...')` calls therefore remain same-origin.

## API request compatibility

The proxy forwards method, query string, request body, cookies, authorization/custom headers, response status, response body and response headers, except hop-by-hop transport headers.

Browser `Origin` and `Referer` values from the random preview port are not passed to Core. When present they are normalized to the existing Core origin. This reproduces the origin metadata that the original web page would send when served directly by Core.

The WebView2 profile remains isolated under `%LOCALAPPDATA%\BONO OS Web Desktop\WebView2Profile`, so browser cookies/storage are separate from Chrome/UYAP.

CI rejects absolute `http://127.0.0.1:47831` or `http://localhost:47831` URLs inside HTML/JavaScript. UI API calls must stay root-relative.

## Web source packaging

GitHub Actions copies the build commit's `web/` directory into a temporary build area and creates:

`web-bundle.zip`

The bundle includes `__bono_web_version.json` with the GitHub commit used for that snapshot.

The release manifest records:

- EXE version;
- EXE commit;
- EXE SHA-256;
- web commit;
- web bundle SHA-256;
- WebView2 SDK version;
- Evergreen Runtime requirement.

At application startup, the bundle SHA-256 is verified before extraction. The embedded web-version commit is then checked against the manifest before the browser is shown.

## Diagnostics

The window title reports both short commit IDs:

`BONO OS · EXE <sha> · UI <sha>`

If the two commits differ, a visible warning banner is shown.

The local preview server also exposes a diagnostic-only endpoint:

`/__bono/version`

It returns the EXE commit, web commit, match state and web bundle hash.

## Updater transaction

The updater treats these files as one version:

- `BONO OS Web Desktop.exe`
- `web-bundle.zip`
- `release-manifest.json`

Both EXE and web bundle hashes are checked before staging and after installation. Backup and rollback always move the EXE and web bundle together. A tampered EXE or tampered web bundle is rejected.

## Isolated Chat-UI / Chat-UYAP integration plan

The WebView2 build consumes the current `web/` snapshot from `feature/desktop-webview2`. This means Chat-UI and Chat-UYAP changes can be tested without copying files into the live Core.

Recommended integration contract:

1. Chat-UI changes only the relevant `web/` UX/source files and accompanying non-mutating regression tests.
2. Chat-UYAP adds/changes API endpoints on its own branch and adds frontend API calls separately.
3. Before backend merge, UI behavior is tested in Actions with fake Core endpoints through `LocalPreviewServer`.
4. For real-backend integration, create an isolated integration branch/worktree containing both changes and run the same WebView2 artifact against an isolated Core process/database copy.
5. Do not point mutating document-download tests at the live Core unless separately approved.
6. Keep document-list inquiry and download actions separate: listing tests may be non-mutating; download/queue actions require explicit live-test approval.

Current CI already verifies the single-case UYAP document-list UI without automatically downloading documents.
