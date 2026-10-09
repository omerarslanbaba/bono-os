# PR22: arm before opening the CBS panel

The live attempt produced zero stored events. Opening the observed `Pencere Görünümü` button automatically selected Evrak before the observer was armed. No request identity or document count was proved by that attempt.

The isolated fix recognizes the already observed `dosya-goruntule` button inside a table row. The first two cells must exactly match the pinned unit name and case number. Only a request started synchronously during that trusted click can pass the existing causal check. At response capture, a unique visible Evrak tab and matching panel title must resolve to a panel. Missing or conflicting context stops capture. Request dosyaId still must match the pinned source case ID. A delayed asynchronous portal request remains unverified and is rejected; time proximity is never a substitute.

Acceptance after separately approved deployment: retain the existing CBS result list; close any existing panel only if this produces no new query; arm the observer against the visible target row; click its Pencere Görünümü once. Do not subsequently click Evrak or repeat the operation. If the first response has no provable origin, report the missing evidence and stop.

No source DB writes, metadata import, download, queue changes or permission changes are added. Unknown group ownership remains unknown. The current live observer build is unchanged by this isolated fix. Deployment requires a new hash-verified package and explicit approval; the original package cannot be overwritten or treated as this build.

Validation: causality tests include target row opening, wrong row and absent panel rejection; existing controlled-observation, privacy/contracts and package apply/rollback suites also pass. Synthetic tests do not prove the portal sends its requests synchronously.
