# PR22 — background user query runtime

## Fixed causes

The normal page probe emitted `probe_ready` without `probeVersion`, `buildId` and `documentId`. Content required these fields and therefore never opened the execution gate. The handshake now includes all three. A pending explicit user action can request the existing session probe on an inactive authorized UYAP tab; startup alone still sends no portal request.

A command result previously cleared its content lane before Core acknowledged receipt. A failed local delivery lost the result. Results now carry an execution UUID and page document UUID, must come from the claiming tab/frame, and keep the lane until receipt. Up to three local delivery attempts do not re-execute the UYAP request. Exhaustion blocks the lane and reports failure; recovery after extension/service-worker restart is not automatic replay.

HTTP 200 application denials, non-JSON, invalid JSON and oversized responses are failures. Existing endpoint allowlists, grant expiry, rate limits, binding checks and download pause remain authoritative. Only transient allowlisted Bridge diagnostics are added to the session API; arbitrary fields are discarded, with no new diagnostic DB table.

## Observer evidence limit

The previous live acceptance had zero captured events and a generic stop reason. Its precise failure trigger cannot be proved retrospectively. Existing observer stop messages now preserve allowlisted reasons, but no new live observer success is claimed. Normal command execution uses the existing validated request adapter and directly correlates its response with the command; it does not depend on the manual observer click window.

## Isolated verification

`npm run test:bridge-user-query-e2e` runs production Core HTTP routes and actual background/content/page-probe sources with a synthetic Chrome surface and synthetic UYAP responses. It verifies inactive-tab execution, one court document request, one local delivery retry, returned court metadata, foreign/late response rejection, CBS exact identity return without document import, and HTTP 200 denial. Portal network is mocked; this is not a real WebView2 or UYAP acceptance.

Also passed: usability (22), user-query policy (25), controlled observation (18), causality (14), capability contract (16), extension explicit-action test, CBS integration, and both existing WebView2 HTTP flow fixtures. Tests use isolated DBs. No live installation, queue change, query or download was performed.

## Supported boundary

Court metadata works in the verified fixture contract. CBS user-query identity discovery returns the exact matched local case through the existing CBS adapter. CBS source/group/document ownership is still unverified: no CBS metadata import or download is enabled. The UI explicitly distinguishes CBS identity completion from document-list completion. No guessed portal selector or new endpoint is introduced.

## Separate live authorization required

One maintenance scope must back up and verify current preimages, stop the observer gracefully, restore the normal runtime through the existing guarded rollback, install reviewed runtime files with exact hashes, and deploy matching browser/WebView2 UI artifacts without mixing bundle identities. Verify user-controlled policy, old-command non-claimability, expired grants, and unchanged manual download pause before normal startup. Do not replay #17614 or run a migration implicitly. Extension reload is a one-time deployment action, not part of daily querying.

Then the user starts one case 93 refresh from BONO. Acceptance tracks claim, authorized session, exact CBS identity and Core result. Stop on permission/identity/contract failure. CBS document metadata remains blocked unless its independent source-ownership evidence is established. This maintenance and real query have not been authorized for this revision; physical download remains separate. The currently installed observer is not changed by this commit.
