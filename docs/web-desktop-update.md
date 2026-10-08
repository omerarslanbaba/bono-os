# BONO OS Web Desktop Preview — Safe Update Procedure

This procedure is for the isolated WebView2 desktop preview only. It does not replace or reuse the older native WPF updater.

## Fixed preview location

Future fixed executable path:

`%LOCALAPPDATA%\BONO OS Web Preview\current\BONO OS Web Desktop.exe`

Supporting folders:

- `backups\` — timestamped previous preview versions.
- `staging\` — temporary verified update staging.
- `state.json` — last successful install or rollback metadata.

Existing BONO OS executables remain untouched until a separate migration is explicitly approved.

## Runtime model

The application uses Microsoft Edge WebView2 Evergreen Runtime. The Runtime is not bundled into this preview EXE. The application checks Runtime availability before creating the WebView2 environment and shows a dedicated message when it is missing.

BONO Core remains a separate local process. The desktop app only performs a read-only GET request to:

`http://127.0.0.1:47831/health`

If Core is unavailable, the app reports that state and does not attempt to start, stop, restart, or modify Core.

## Package contents

The GitHub Actions package contains:

- `BONO OS Web Desktop.exe` — the only executable binary.
- `web-bundle.zip` — the exact `web/` snapshot from the same build commit, including `__bono_web_version.json`.
- `release-manifest.json` — product, EXE/web commit IDs, WebView2 SDK version, Runtime requirement, Core health URI, EXE SHA-256, and web bundle SHA-256.
- `SHA256SUMS.txt` — hashes for both EXE and web bundle.
- a versioned ZIP artifact.

Version format:

`0.1.0-webpreview.<GitHub Actions run number>`

## Read-only plan

This validates the package and reports current Core health without installing anything:

```powershell
.\scripts\web_desktop_updater.ps1 -Mode Plan -PackagePath "C:\path\to\package"
```

## Install after explicit approval

Close the WebView2 preview first. Then:

```powershell
.\scripts\web_desktop_updater.ps1 -Mode Install -PackagePath "C:\path\to\package" -Approve
```

The updater:

- refuses modification without `-Approve`;
- refuses to replace the fixed EXE while it is running or locked;
- verifies the source package SHA-256;
- copies to staging and verifies again;
- backs up the current EXE and manifest;
- swaps only the WebView2 preview EXE;
- verifies the installed EXE;
- automatically restores the backup if a post-swap failure occurs.

It does not call UYAP APIs, mutate queues, modify the DB, alter the Chrome extension, or touch archive files.

## Rollback

Close the preview app, then:

```powershell
.\scripts\web_desktop_updater.ps1 -Mode Rollback -Approve
```

Use `-BackupPath` to select a specific timestamped backup.

## CI regression coverage

`scripts/test_web_desktop_updater.ps1` uses only a random directory under `%TEMP%` and verifies:

- package/manifest hash acceptance;
- explicit approval requirement;
- locked EXE refusal;
- initial install;
- simulated post-swap failure and automatic recovery;
- second-version install;
- rollback;
- tampered package rejection.

No live BONO OS path is used by these tests.


## Bundled UI and Core API origin

The browser no longer navigates to the live Core root page. The app verifies and extracts its packaged `web-bundle.zip`, then serves that snapshot from an ephemeral loopback-only origin. Root-relative `/api/*` and `/health` requests are proxied server-side to the existing Core.

This keeps the original web UI URL model same-origin inside WebView2 and avoids CORS/mixed-origin changes. The live Core `web/` directory is not modified.

The window title shows the EXE and UI short commit IDs. A visible warning appears when they differ.
