# BONO OS dead-code and technical-debt audit

Audit base: `integration/webview2-uyap-single-case@4dd72077bf7ae99ed7d9a73294c41fd53d81ae3c`

Baseline Windows regression:
- run: https://github.com/omerarslanbaba/bono-os/actions/runs/37819647018
- result: PASS
- package: `0.1.0-webpreview.118`
- EXE SHA-256: `4e58e3ba15a7c11f6f6e4f90664d3471f747926f33c1ff7256d1e8ee6c8825b3`
- web bundle SHA-256: `6b23c08d56d6f2dd90542616d48de62442137b10ac16d0a87d64c5c9d7062f54`

## Audit method

The classification does not rely on a single static-reference grep.

The following dependency surfaces were checked:
- npm scripts and GitHub Actions workflows;
- the active web router and explicit module imports;
- bridge server, worker, repository and job execution paths;
- worker dynamic Python-script execution;
- Chrome extension/runtime files;
- WebView2 packaging and updater scripts;
- current isolated UYAP/Archive regression tests;
- old/native rollback tooling;
- tracked build artifacts and ignore rules.

No live Core, DB, queue, UYAP extension, Downloads, Dava Dosyaları or installed EXE was inspected or modified.

## A — safely removable

These files have no runtime, build, test, worker, extension or updater dependency and are tied to obsolete one-off development data/routes.

### `scripts/cleanup_old_integration_jobs.js`
- hard-coded to job IDs 35, 36 and 37;
- deletes only those historical rows after matching old error strings;
- not referenced by package scripts, workflows, bridge, worker or extension;
- not a reusable migration or rollback path.

Decision: remove.

### `scripts/cleanup_regression_jobs.js`
- hard-coded to old failed job IDs 91, 92 and 93;
- purpose is one-off cleanup of obsolete regression rows;
- no runtime/build/test reference;
- retaining a destructive DB helper with frozen IDs creates more maintenance risk than rollback value.

Decision: remove.

### `scripts/cleanup_v05_temp.js`
- deletes only cases whose external ID starts with `__v05test_`;
- current `scripts/regression_v05.js` creates a unique v05 fixture and deletes its own case in its cleanup path;
- no package/workflow/worker reference.

Decision: remove.

### `scripts/screens_v05.js`
- hard-coded screenshot helper for historical routes such as `#cases`, `#calendar` and `#documents`;
- current router exposes `today`, `uyap`, `hearings`, `powers`, `accounting`, `system`;
- not used by runtime, CI, packaging or tests.

Decision: remove.

## B — archive / preserve for rollback value

### `desktop/BonoNative/**`
The native WPF UI is no longer the product direction, but it still has historical rollback/reference value.

Evidence:
- `.github/workflows/native-build.yml` can still build it manually/on main;
- `tools/Update-BonoNative.ps1` is explicitly tied to its artifact;
- removing it would destroy a working rollback/reference implementation rather than dead code.

Decision: keep; do not delete in this PR.

### `.github/workflows/native-build.yml`
Legacy native build workflow. It belongs with the WPF rollback surface.

Decision: keep with BonoNative.

### `tools/Update-BonoNative.ps1`
Legacy native updater. Not used by the WebView2 updater, but still paired with the archived native workflow.

Decision: keep with BonoNative; never run against the user's desktop during this audit.

### `web/js/views/legacy/**`
The active router imports only `web/js/views/active/**`, so these modules are not current runtime code. However, the directory is explicitly named `legacy` and preserves the former web application implementation as a rollback/reference snapshot.

Decision: keep as archive; do not delete.

### historical regression/inspection helpers
Examples:
- `scripts/regression_v04.js` … `regression_v08.js`
- `scripts/inspect_udf*.py`
- `scripts/udf_failure_summary.py`

They are not part of the current CI path, but remain useful for forensic/regression work against older schemas and UDF parsing.

Decision: keep for now; a later archival move can be done separately if desired.

## C — preserve / active or potentially active

### Current WebView2
- `desktop/BonoWebDesktop/**`
- `desktop/BonoWebDesktop.Smoke/**`
- `.github/workflows/web-desktop-preview.yml`
- `scripts/web_desktop_updater.ps1`
- `scripts/test_web_desktop_updater.ps1`

All are active packaging, runtime or safety-test dependencies.

### Core / worker / extension
- `bridge/server.js`
- `bridge/worker.js`
- `bridge/jobs.js`
- `bridge/repository.js`
- `bridge/uyap.js`
- `bridge/v04.js`, `v05.js`, `v06.js`, `v09.js`
- workflow/event/deadline/UDF modules
- `extension/**`

These are directly referenced by npm syntax checks, server startup, the worker, extension runtime or current tests.

### Worker-invoked Python
The worker dynamically executes these names, so they must not be removed based on static JavaScript imports:
- `scripts/extract_container.py`
- `scripts/convert_archive_file.py`
- `scripts/convert_archive_format.py`
- `scripts/import_vekalet.py`
- `scripts/index_udf_library.py`
- `scripts/index_pdf_library.py`

### Current UYAP and Archive fixtures
Current document.list, targeted case search, CBS party-search, 200-document batch, document-view and WebView2 E2E fixtures are active regression dependencies.

Decision: preserve.

### `scripts/cleanup_v09_generated.js`
This script mutates current v09-generated data and re-runs active v09 scanners. Although manual and potentially dangerous, it is not clearly obsolete.

Decision: preserve as C; do not remove without a separate v09 maintenance decision.

### Watchdog/startup helpers
`BONO_OS_Watchdog.cmd` and `bono_watchdog.ps1` can start/restart the local Core and therefore remain operational tooling.

Decision: preserve; not executed during this audit.

## JavaScript imports / CSS / endpoints

No additional A-class removal was approved from active JavaScript or CSS.

Reasons:
- current UI builds substantial markup dynamically;
- class names and routes can be created through template strings and DOM APIs;
- Core endpoints are consumed by WebView2, worker, extension and isolated integration tests;
- removing a selector or route based only on text-reference counts would violate the audit safety rule.

Legacy JS remains B, active JS/CSS remains C.

## Build artifacts

No tracked `bin/`, `obj/`, publish directories, EXEs, DLLs, DBs or ZIP preview artifacts were found in the repository tree.

The existing `.gitignore` already excludes:
- `**/bin/`
- `**/obj/`
- `**/publish*/`
- runtime DB/data/logs;
- archive/document binaries;
- ZIPs and temporary/backup files.

No user's existing preview artifact or desktop executable is touched.

## Cleanup scope for this PR

Only these A-class files are removed:
1. `scripts/cleanup_old_integration_jobs.js`
2. `scripts/cleanup_regression_jobs.js`
3. `scripts/cleanup_v05_temp.js`
4. `scripts/screens_v05.js`

Everything in B and C remains unchanged.
