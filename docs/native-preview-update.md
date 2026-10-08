# BONO OS Native Preview — Safe Update Procedure

This is infrastructure only. It does **not** replace, move, delete, or launch any existing BONO OS preview executable.

## Fixed preview location

The future stable preview launch path is:

`%LOCALAPPDATA%\BONO OS Preview\current\BONO OS Native.exe`

Supporting folders:

- `backups` — timestamped previous versions.
- `staging` — temporary verified update staging.
- `state.json` — last successful install/rollback metadata.

Existing desktop preview EXEs remain untouched until a separate migration is explicitly approved.

## Build package

GitHub Actions workflow: `Native Preview Release + Updater Safety`.

Each package contains:

- `BONO OS Native.exe` built in Release, self-contained, single-file mode.
- `release-manifest.json` with preview version, full commit SHA, short commit and SHA-256.
- `SHA256SUMS.txt`.
- a version/commit-named ZIP artifact.

Version format: `0.1.0-preview.<GitHub run number>`.
The commit is also embedded as informational version metadata.

## Safe install

1. Download and extract one Actions artifact.
2. Plan only; this verifies the manifest and SHA-256 and writes nothing:

```powershell
.\scripts\native_preview_updater.ps1 -Mode Plan -PackagePath "C:\path\to\package"
```

3. Close BONO OS Preview.
4. Only after explicit user approval:

```powershell
.\scripts\native_preview_updater.ps1 -Mode Install -PackagePath "C:\path\to\package" -Approve
```

The updater refuses modification without `-Approve`, refuses to replace the fixed EXE while it is running/locked, verifies the package before staging, backs up the current version, swaps only after verification, verifies again after the swap, and automatically restores the backup if a post-swap failure occurs.

It never starts/stops BONO Core, UYAP extension, query/download lanes, DB jobs, or archive tasks.

## Rollback

Close the preview app, then explicitly approve rollback to the most recent backup:

```powershell
.\scripts\native_preview_updater.ps1 -Mode Rollback -Approve
```

A specific timestamped backup may be supplied with `-BackupPath`.

## CI safety tests

`scripts/test_native_preview_updater.ps1` uses only a random directory under `%TEMP%` and tests:

- manifest/hash verification;
- initial install;
- automatic restoration after a simulated post-swap failure;
- normal second-version install;
- rollback to the previous version;
- rejection of a tampered package.

No live BONO OS location is used by these tests.
