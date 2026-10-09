# PR #23 — Physical filesystem acceptance, isolated

Executed with `node --test scripts/bulk_download_acceptance.test.cjs scripts/bulk_download_filesystem.test.cjs`: 16/16 passing (8 in-memory + 8 temporary-filesystem).

## Actual production code exercised
- `bridge/archive_safety.js` `sha256File`, `sameSha`, `copyVerifiedIntoCase`: real bytes, verified temp copy and atomic rename, idempotent canonical target, conflicting canonical target rejection, size/hash comparison, and target-directory containment.
- All writable paths in these tests are newly created `os.tmpdir()` subfolders, removed in `finally`. No UYAP or live DB/installation access.

## Read-only production findings, not directly integrated
- `bridge/uyap.js` `enqueueRemoteDocumentDownload` deduplicates active download commands and uses document metadata; `caseDownloadSummary` exposes `manualDownloadPaused`, queue capacity and counts. The observed staging routine writes bytes using `fs.writeFileSync` and calculates a SHA-256; direct live queue and staging execution were deliberately excluded.
- `bridge/worker.js` updates `uyap_remote_documents` filing state and calls the archive policy; these DB/manifest transitions were not executed by the test.
- `bridge/v05.js` also contains filesystem archive relocation, separate from the verified copy helper. Its migration/archive behavior is not covered by these tests.

## Limits before integration
- Paused/no-consent guards run in a deliberately isolated adapter; they do **not** prove production Core rejects queue creation or dispatch while paused.
- Restart acceptance reconstructs synthetic state and physical files; it does **not** restart Core or recover actual DB transactions.
- Equal SHA-256 with separate source identities is tested as independent legal links. Single shared physical canonical blob for two case records requires an explicit approved production mapping and DB adapter.
- Atomic rename is exercised via the real helper but power-loss crash consistency and concurrent writers are not tested.
- Await PR #22 parser's verified per-document identity, owning `dosyaId` and group/attachment provenance before connecting a batch; unsupported or incomplete CBS records must remain unqueued.
- No claim of production GO, live UYAP compatibility or physically complete archive.

No PR #22 files changed.
