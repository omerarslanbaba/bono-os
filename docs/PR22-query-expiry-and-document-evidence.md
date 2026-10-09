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

## Controlled inspection attempt — 2026-10-09
Explicit approval covered only opening the existing target case and its documents, with no new case search. Browser extension connection succeeded. Fresh tab inventory replaced stale tab635225735 with existing tab635225748 at /dosya-sorgulama. Visible UI: judgment type Ceza, no selected judicial unit, no results, prompt to search. Neither target case nor document panel was present. No click, navigation, search, portal request or Bridge command was initiated. No technical source identity, document identity, parent/group link, pagination or download reference was newly verified.

Contract status remains unknown/unverified for CBS document groups and children; executable=false and fail-closed ownership remain unchanged. Do not infer a relationship to 2026/51962 or instruction files. No parser change is justified by this attempt. Required next user action: leave the already authorized target Eskişehir CBS 2026/51832 case open at its Evraklar panel and notify the agent; no additional agent case search is authorized. Existing structural summaries may still be insufficient for scalar identity proof after the panel is available.

## Authorized target panel observed — 2026-10-09
User opened the panel. Existing tab635225748 showed selected Eskişehir CBS 2026/51832 and its Evrak tab. All documents contains sibling groups 2026/51962 (CBS), 2026/11706 (instruction), 2026/51832 (CBS), 2026/9621 (instruction). Expanding only the target group exposed 23 category nodes with displayed counts summing to51. This is a visible UI subtotal, not a proven complete remote inventory. No leaf/viewer/download was opened; no other group was expanded.

Read-only DOM inspection found a positional data-item-id, ARIA level2 and a generated dx identifier. These are UI identifiers, not opaque source dosyaId. DOM hierarchy establishes display nesting only; it cannot establish the legal link between sibling groups or source identity of child documents.

Live Bridge summary rows11/12 were last seen at2026-10-09 09:16:35 UTC with16 hits each. Their retained request dosyaId differs literally from the current case93 identifier. These aggregated rows lack tab/frame/event correlation, so neither the selected panel's request nor a wrong-case cause can be established. No opaque values are included here. Stop condition applied: no further UI input/request, import, download or live change. Command17614 remains queued/attempts0.

The contract fixture PR22-cbs-visible-evidence.json records this distinction. Source dosyaId, evrakId, viewer/download reference, pagination completeness and legal relationships remain unknown. CBS executable=false and ownership fail-closed remain unchanged. The missing evidence is a same-event, same-tab target-panel request and its sanitized full group/child metadata response. Existing aggregated Bridge summaries cannot reconstruct it; no new observer, CDP policy bypass or guessed parser was introduced. Isolated expiry fixes remain delivered; full CBS document-chain acceptance remains blocked on source identity proof.
