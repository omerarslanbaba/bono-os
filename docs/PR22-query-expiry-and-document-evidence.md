# Query expiry fix and remaining real document evidence

Based on PR20 a98cdf0 and PR21 6d9aae7 policy (read, not merged).

## Isolated changes
- A fresh explicit CBS/court query does not reuse an expired grant. Existing command/grant history is retained; grant expiry is not extended.
- History GET derives expired/unknown status without writing queue or audit rows. UI stops indefinite monitoring and allows a fresh explicit action.
- Claim cleanup distinguishes expired queued actions from changed identity; expired running actions remain execution_unknown. Late results cannot revive them.
- Managed document-list dedup cannot rewrite a grant-hashed payload; expired managed commands do not block new ones.
- CBS cache age uses SQLite date parsing instead of lexicographic ISO-versus-SQL timestamps.

## Read-only live boundary
Case93: command17613 completed, command17614 queued/attempts0; remote metadata count0. No live code, DB, queue, pause, Bridge or desktop installation in this change.
Retained observation12 contains request plus summary keys, not full group/child/source values. Observation11 does not establish completeness. No observation event store exists in the live DB. Original Bridge claim failure during the previous grant window is unknown.

## Tests
PASS: test_user_queries (25 safety scenarios including expired court grant), test_uyap_cbs_user_query_integration (pagination/cache/exact match plus expired action, readonly diagnosis, fresh dedup, late result rejection), test_uyap_single_case_sync, test_case_usability (21), test_uyap_case_document_contract (21), test_uyap_query_capability_contract (16), test_user_query_extension, test_webview2_uyap_single_case_e2e. All query execution fixtures are isolated; no real UYAP acceptance test.
The WebView2 test had an outdated source-string assertion after PR20 extracted partyText. It now checks the actual helper and its list invocation; the DOM usability test separately checks rendered parties.

## Remaining acceptance gate
The complete CBS document/download chain is NOT delivered. Need one explicitly approved target-only portal interaction: selected Eskişehir CBS 2026/51832 context -> Evraklar, with real request identity, complete group/child/source structure and available viewer/download references. Do not replay command17614, bulk-query, import uncertain groups or download. Existing Bridge structural summaries omit values and unknown field names: they alone cannot prove source identity or produce document metadata. Inspect the existing authorized UI/Bridge evidence first; if it cannot expose the required fields, stop and request the narrow missing evidence rather than bypass Chrome policies or deploy an invented parser.
No live installation package is issued until this evidence-dependent work is complete. Full source binding, linked-group selection and physical archive acceptance remain pending. User selection cannot replace source identity proof.
