# Controlled observation identity v3

Isolated PR22 continuation from bc386d9. No live deployment/request/import/download.

## Implemented boundary
- Existing observation-only extension/Core path, unchanged normal executor and WebView2 UI.
- Start pins source DB identity, unit name, case number, tab, frame, document and session. New causalVersion handshake rejects the old probe.
- Trusted click must be on the exact CBS group or Evrak tab within the unique target-title subtree. No invented portal-specific selector or application state access. Panel receives a per-document reference.
- Only requests initiated while that trusted event is still dispatching have synchronous causal attribution. Event phase, not timestamp proximity, controls this claim. Async/deferred origins are unknown and stop capture; no async monkeypatching.
- Every fetch/XHR invocation owns a UUID and request sequence captured in its response closure. Reverse-order concurrent responses keep their own request identity. Duplicate event/sequence, other tab/frame/session and stale records are rejected.
- Core compares request identity literally to pinned source identity. Mismatch/conflicting body/query identity is a stopped diagnosis, saved without raw IDs. It never grants metadata/download permission.
- Bounded group/child object graph records known field presence only (dosyaId, evrakId); identifiers become session-keyed HMAC references. Parent edges and safe group labels are kept; missing IDs are not inherited. Unknown field names/semantics remain unknown. No source ownership inference from title, nesting or user choice.
- No raw response, document content, arbitrary labels, credentials or personal fields persist. Existing source DB remains read-only; events use the separate observer evidence DB.
- Existing observation screen shows Core stop reasons. Queue, auth probing and download executors remain off in observation-only mode.

## Limits
The real CBS full schema has not been observed. The graph captures occurrences and equality of the already observed identifier field names, not verified legal meanings. An identifier under an unknown field is omitted. No import adapter was enabled. A group without source ID stays unverified.
The unique title subtree must actually be identifiable; otherwise capture stops. A cached tab/group expansion can generate no network request. Async portal requests cannot be attributed by this minimal mechanism and are rejected, not guessed. Thus no guarantee that the next live interaction will yield sufficient evidence.

## Isolated tests
PASS test_observation_causality: trusted group and Evrak tab, concurrent reverse responses, async origin rejection, foreign tab, old session, duplicates, mismatch stop, identity pseudonyms, missing source, privacy, body/query conflict, import/download closed.
PASS test_controlled_observation (18), test_observation_package (21), test_uyap_observation_contracts, test_user_query_extension, test_user_queries, test_uyap_cbs_user_query_integration, test_case_usability (21).
All requests in observation tests are fixtures. No real UYAP acceptance test or live installation occurred.

## Single live acceptance action (separate installation/observation approval)
After an approved version-matched observer installation and source/evidence separation preflight, user confirms existing Eskişehir CBS 2026/51832 panel, arms case93 for that tab/frame, and clicks its Evrak tab once. No new CBS search, replay17614, manual request, import or download. If cached/no request, asynchronous origin, missing title/source IDs, mismatch or authorization denial occurs, stop and report the precise missing evidence; do not send a second request. Success requires matching request identity, paired complete response and adequate group/child identifier graph; metadata and download remain separate later approvals. Rollback/normal-Core return retains the prior approved maintenance safeguards.
