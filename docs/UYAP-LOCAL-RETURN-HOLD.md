# Optional local return after observation

The normal browser executor can immediately claim an existing discovery queue when
it is enabled. Manual download pause does not stop queries, and successful
discovery results can enqueue more pages, files and document metadata requests.

An optional **local return hold** keeps normal BONO local services available while
blocking all UYAP queue claims and late result imports before their database
writes. The boot flag is immutable within the UYAP module. Normal behavior is
unchanged when the flag is absent.

## Installation artifact

`scripts/build_local_return_package.js <confirmed-live-root> <new-isolated-output>`
reads only two source preimages: `bridge/server.js` and `bridge/uyap.js`. It refuses
an observer/already patched source or ambiguous patch anchors. It preserves the
existing source except for the hold prefix, claim/result guards, exported status
and health field. No integration branch replacement, DB/settings migration, EXE
or extension change is included.

The overlay is a **separate approval**, applied only after the observer package
has been rolled back and all desktop/Core processes are stopped. It uses the
existing PowerShell process/port gates, atomic installer, hashes and exact
preimage rollback. Its journal is `.bono-local-return-state.json`; the shared
operation lock remains exclusive. A completed observer rollback journal is not
overwritten. Unknown Node command lines still reject mutation.

The installed server unconditionally sets `BONO_UYAP_EXECUTION_HOLD=1` before
imports. Restarting it with an unset/zero environment value, including a desktop
watchdog restart, cannot release the hold. `/health` must report
`uyapExecutionHeld:true`. Releasing the installed hold requires stopping services,
an explicitly approved exact rollback and another controlled restart. There is
no HTTP unlock or queue cancellation.

## Limits and operational requirements

- The normal extension and all other executors remain disabled. Its direct auth
  probes are outside the Core claim gate. This is local BONO availability, not
  unrestricted UYAP operation.
- Normal startup recovery, scan jobs and the worker continue. They can write the
  DB, add queue work, create backups and process local archive files. The hold is
  not a read-only mode or an archive/job freeze. Those normal-return effects need
  explicit operational approval.
- Before opening the desktop, verify the confirmed `BONO_HOME`, absence of
  `data/pending_restore.json`, clean port/process state and installed hashes.
  Start the desktop from an explicit child-process environment bound to that
  root, then verify its child Core PID/port/health. Do not modify persistent user
  environment settings to launch it.
- Desktop X hides the window. Tray Exit kills its owned child Core. There is no
  atomic drain handshake in the existing desktop: check active jobs/commands
  immediately before exit, abort if active, and explicitly account for the small
  check/exit race and normal recovery effects. Do not claim graceful shutdown.
- Restoring the overlay preimages does not restore the DB. Keep observation
  evidence and backups separate; data restore needs its own decision.

## Verification

`test_local_return_hold.js` verifies 270 synthetic queued rows, a stale running
row, all lanes, late results and immutable boot state.

`test_local_return_package.js` verifies separate journals, idempotent apply and
rollback, interrupted installation, exact preimages, unknown source rejection,
ambiguous anchors and rejection of an unreadable Node process by the original
PowerShell preflight.

`test_local_return_runtime.js <overlay-bundle>` applies the actual artifact to a
synthetic installation, starts the normal Core with its worker enabled, checks
the local UI/claim/result APIs, restarts it, verifies all 270 original queue rows
and session/pause values, then rolls back. The live preimage has a fixed port;
the fixture remaps **only that port** to a free loopback port before execution,
then restores the exact installed bytes before hash/rollback checks. No real
desktop, Chrome executor, portal request, archive or source DB is used. This is
not evidence of live Chrome or desktop session preservation.
