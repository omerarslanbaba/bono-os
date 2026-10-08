# CBS unit list adapter — existing evidence, isolated delivery

This is unit/status listing followed by local exact investigation-number selection. It is **not** a direct investigation-number endpoint or party search. `bridge/uyap_cbs_list_adapter.js` has no I/O and is not registered with an executor.

## Evidence reviewed on 2026-10-09

The existing live BONO database was opened using native SQLite `readOnly:true`; no live runtime modules were imported. Existing, independently collected Bridge records were examined, not a new browser network capture.

* Observation #36: POST `/avukat_dosya_sorgula_cbs_brd.ajx`; request keys/types `dosyaDurumKod:number`, `pageSize:number`, `pageNumber:number`, `birimId:string`, `birimTuru2:string`, `birimTuru3:string`. Observed template: empty `birimId`, unit in `birimTuru2`, `birimTuru3="3"`, page size 500, page 1. No server-side year/number/party parameter was observed.
* Observation #35: POST `/cbs_birim_sorgula.ajx`, `ilKodu:number`; unit response includes `birimId`, `birimAdi`. Existing completed unit results remain the unit-selection source.
* Existing completed CBS results: 1,207 sampled, 14 nonempty recognized envelopes, one unrecognized result. Recognized envelope is `[rows,total]`; row identity keys are `birimId`, `dosyaNo`, opaque `dosyaId`. Unsupported envelopes are rejected, never coerced into success.
* Completed command #800 (2026-10-08 17:55:52): one row, total one, target unit/2026/51832/opaque ID exactly agree with stored case 93. Running the pure selector on this existing result returned `found`. No opaque ID or raw payload is copied into this document or fixtures.
* This is historical list-to-record consistency, **not** proof of the current open panel's request identity, access permission, freshness, or document ownership.
* Existing page probe persists request shape and response **summary**, not full CBS rows. Observation #36's sample keys (`[]`, `0`) alone cannot establish the nested row schema; completed command results provided that evidence. Document observation #12 preserves group/count summary only, not per-item ownership metadata. No event observation table is installed in the inspected live DB.

## Missing link and implementation

Existing `enqueueCbsSearchPage` combines listing with discovery; its result path can upsert every row and automatically continue pagination/document synchronization. The targeted CBS party search additionally requires party schema and enqueues party lookups. Neither is the side-effect-free general unit/status list-to-target selection needed here.

The adapter reuses the observed request contract without party calls, personal data, bulk upserts or guessed fields. It checks unit provenance, exact local number match, opaque ID conflicts, envelope shape, status/unit scope, sequential pages, stable totals and duplicate identities. Incomplete pages cannot certify identity/absence. Pagination requests are descriptions only; caller must have separate explicit authorization. Even a complete result never grants document binding permission.

Request preparation requires the existing observed 500-row template. Other sizes are not invented. This may enumerate a unit's files and therefore remains subject to separate scoped listing permission. No auto-pagination or scheduling is implemented.

## PR compatibility and remaining runtime gate

* PR #13, b5ac6d4: user-query grants currently cover `document.list`, separately consented downloads, and certified court bindings. CBS search cannot be dispatched through this new module. No queue/migration/history/worker changes are made. Enabling this flow would require an explicit action grant and history contract for a scoped CBS list, not a bypass of `beforeEnqueue`.
* PR #17, 9559738: pass the selected identity through the existing exact identity contract. Document-list ownership still requires exact per-item `dosyaId + evrakId`; mixed investigation/talimat groups cannot be flattened into a verified target.
* PR #18, 00b6cf2: `DIRECT_CBS_NUMBER_FLOW_UNSUPPORTED` remains correct. A future diagnostic extension must name `unit_status_list_local_exact_match` separately, backed by trusted source references, rather than declaring direct number or party search supported. No capability flags are changed here.
* A current verified document-list request/response with item ownership is still required before metadata import or downloading. Existing Bridge summaries cannot reconstruct discarded fields. Fresh capture would require separately approved observation; current browser Network restrictions are not bypassed.

`VISION.md` and `AGENTS.md` were sought in the working tree, workspace, fetched main/PR branches and fetched history; neither was available. Their contents are not claimed to have been reviewed. PR descriptions and the PR17/18 contract source/documentation were reviewed.

## Validation

`node scripts/test_uyap_cbs_list_adapter.js`: 19 PASS, synthetic identifiers only.
Existing `test_uyap_targeted_cbs_party_search.js` and `test_uyap_single_case_sync.js`: PASS.
Syntax check and `git diff --check`: PASS.
Historical command #800 selected through the pure adapter using read-only DB access: `found`, stored identity agrees, `canBindDocuments=false`.

Live queue counts differ from the old 270-command snapshot and changed between read-only samples. No attribution is inferred. A future migration must obtain a fresh consistent inventory; the old 270 count must not be reused as a current invariant. No command was claimed, executed, changed or retired by this task.
