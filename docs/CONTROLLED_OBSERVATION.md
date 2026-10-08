# Controlled CBS observation v2

This is isolated development. It neither verifies case 93 nor authorizes deployment or a portal action.

## Safety boundary

The explicit popup starts a 60-second session for one tab, frame and document. Session and network event IDs are distinct. Only the two previously observed document-list paths are eligible. A trusted click on an exact, recognized CBS group label supplies an action marker; it proves that click, not file ownership. No guessed DOM selector or endpoint is used. Other clicks, keyboard input, navigation, selected anchor removal/change, target tab closure/deactivation, expiry, ID mismatch, application denial or incomplete capture stop or reject evidence. Unobservable changes that leave the anchor unchanged remain a limitation; the next mismatched request is rejected.

The probe is passive: it wraps requests already made by the portal. Install and arm send no UYAP requests. Request body streams in a Fetch Request object are not read; absent IDs fail closed. Cached expansion may produce no capture; do not retry automatically.

The observation-only bootstrap imports no normal Core DB/jobs/worker/recovery modules. It reads the case table through SQLite readOnly and writes a separate evidence DB. Query claims return 204; normal command/result/download endpoints are unavailable. Source DB, queue and manual pause are unchanged. Normal Core services, WebView2 and Archive APIs are unavailable during this maintenance mode. Normal Core restart later can resume existing startup/recovery behavior; it requires its own reviewed maintenance step.

## Evidence and privacy

Only safe case-number labels, allowlisted group types, structural parent/child edges, primitive types, bounds, method/path/status, timestamps, scoped IDs and an ephemeral HMAC request reference are retained. No scalar response values, arbitrary labels/keys, document contents or authentication headers are retained. Privacy omissions and capture bounds are distinguished. No raw response is logged on failures. Unknown field names collapse to `unknown`; document-ID/download-reference semantics therefore remain unknown. Root HTTP-200 errorCode is evaluated as an application denial. Other undocumented nested errors are not claimed to be understood.

`caseBinding=request_id_matches_user_confirmed_case` means only exact equality with the read-only historical case record after user confirmation. It does not independently prove the selected portal row's unit or every group's ownership. 2026/51962 and instruction groups stay separate and ownership remains unknown. No metadata import is exposed. Discovery contracts remain executable:false; CBS import guard remains fail closed.

## Packaging and rollback

Run `node scripts/build_observation_package.js <explicit-install-root> <new-isolated-output>` to read preimages and generate payload, exact rollback files and SHA-256 manifest. It never copies DB/settings/archive or modifies the installation. Live server changes are preserved by wrapping the exact preimage with an observation-only entry point; integration uyap.js/db.js are not installed.

The PowerShell package defaults to Verify. Apply/Rollback require explicit maintenance approval and an unoccupied Core port. All payload and preimage hashes are checked before changes; changed targets are rejected. Rollback accepts a mixture of original and packaged files after a partial install, restores originals and removes only listed newly introduced files. Evidence DB is retained separately. No process, browser reload or DB migration is started by the installer. Package ZIP hash covers scripts and manifest too; compare it before executing scripts. No signature/attestation is claimed.

Launch requires explicit Node, source DB, new evidence DB, installed extension ID and matching build hashes. Do not run the normal Core concurrently. A mismatched Core is rejected before arm. An old extension cannot be assumed passive; it must be replaced/disabled during approved maintenance. Existing content/probe guards fail closed through missing readiness or conflict. Real Chrome extension reload/page preservation is untested; do not automatically reload the portal.

## One future authorized interaction

First manually confirm the existing 2026/51832 CBS row and panel, case 93 and target frame. After installation approval, verify hashes and readiness without querying UYAP. Separately approve the observation: start popup case93/frame, then click the already visible exact target CBS group once. This may trigger portal document metadata traffic. Do not click other groups or repeat. Stop after capture/60 seconds. If the group is already expanded, the page is cached, the label differs, an old probe remains, or evidence is incomplete, stop and report rather than reload/requery. Reload/reopening a panel requires separate approval because it may query the server.

Metadata transfer and physical PDF/UDF downloads are later, separately authorized stages after ownership proof. No documents may be assigned to case93 on structural capture alone.

## Validation scope

VM probe/content/background tests and an actual isolated Node observer server test cover no automatic requests, two tabs/frames, case changes, delayed responses, missing catalog, old probe guards, secrets, JSON truncation, HTTP200 denial and unchanged source DB/queue/pause. Synthetic package apply/rollback tests preserve a custom server preimage and reject changed sources. Existing court/WebView2/Archive regression scripts are run locally. They are not real Chrome/portal end-to-end tests. The pre-existing test:uyap rate fixture requests an unapproved synthetic endpoint and remains failing; the production allowlist is not weakened.
