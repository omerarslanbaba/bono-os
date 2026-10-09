# PR20 — UI revision and real document-chain boundary

Read-only live checks: 9 October 2026. Installed package and initial PR20 head both 25667b3. This revision is isolated; the working Core, desktop package, Bridge, DB, queue and pause were not changed.

## Delivered UI
- Stacked judgment type/unit, compact local filters, fixed-layout seven-column table.
- One column filter opens at a time; filtering and sorting remain independent. Exact case-ID links retained.
- Existing case history/cache GET monitoring retained; no automatic resubmission.
- Core-approved download options are selected by default. A separate download click plus explicit confirmation is still required. Pause is never lifted.
- Compact month cells, accessible arrow controls, no Today button.
- Today shows hearings and open deadlines in [today, today+7 calendar days), Europe/Istanbul. Earlier today is included; day eight excluded. Uses existing read-only deadlines API, not morning-brief aggregate counters. Daily summary/upcoming/today-task cards removed.
- API limits remain finite (10,000 rows); no claim of unlimited historical coverage.

## Case 93: confirmed evidence
- #17613 completed, one attempt, successful audit reference command:17613.
- Persisted cbsIdentityEvidence references observation:36, unit command:15506 and result command:17613; documentOwnershipVerified=false.
- #17614 remains queued, attempts=0, no dispatch. Its ten-minute grant expired at 11:05:20 Türkiye time.
- Server/worker heartbeat healthy; session/rate ready; manualDownloadPaused=true; GET user-query-state pending=false.
- Current execution blocker is the expired grant. pending() excludes expired grants. Extension auth refresh requires a pending explicit action, so this stale row cannot authorize one.
- Fetch-json execution belongs to Chrome content/background/page-probe, not the jobs worker. The original reason no claim occurred during the grant window cannot be proven from retained evidence. Chrome's ephemeral auth/probe state is unknown; no access-policy workaround was attempted.
- Do not retry or resurrect #17614. A separately authorized reconciliation/user renewal must use the existing safety policy; this revision changes no command state.

## Actual document-list capability
- Persisted Bridge observation:12 shows POST /list_dosya_evraklar.ajx. Only summary keys/counts are retained; not a complete CBS group/child response or proof of case93 ownership.
- Observation:11 covers POST /listDosyaEvraklarPageTotal.ajx. It does not prove all groups/pages were captured.
- Court documents require court_documents_v1 binding plus per-document proof. Current CBS support returns operation=cbs.search, documentBindingAllowed=false; CBS download-options is empty.
- Case93 currently has zero remote documents and zero case_relations. Zero stored documents is not proof of an empty portal tree.
- Needed real evidence: one explicitly authorized target CBS selection -> Evrak/Tüm Evrak trace correlating selected unit/number, actual request dosyaId, full structural group/child IDs, pagination/completeness and viewer/download reference presence. Keep secrets/content out of permanent evidence. A group label or a manual checkbox cannot establish ownership.

## Linked files and physical duplicates
- Keep source case, displayed-in case, relationship type and proof distinct. 2026/51962 and the instruction branches are neither automatically excluded by number nor automatically imported into case93.
- Existing case_relations supports source/target/status/source/metadata but has UNIQUE(source_case_id,relation_type); it cannot represent an arbitrary verified multi-branch history without a deliberate migration.
- local_assets.sha256 is unique; remote rows can reference local assets. Current pre-download stable-key reuse is case-scoped. Global pre-download identity and verified cross-case sharing are NOT implemented or proven by these UI changes.
- Linked CBS/instruction/appeal group selection with reliable unit/number/count/relationship/download metadata is blocked by missing response evidence. No fake group selector/parser was added.
- Current download-options exposes only discovered, proven, nonlocal court documents, capped at 200. Failed-download retry, all related groups and larger multi-batch downloads are not silently enabled.
- Therefore the full cross-case document-chain and no-redownload goal is not complete. It requires the scoped real trace first; no new architecture was invented.

## Tests and deployment
Targeted UI/date tests, user-query policy, CBS integration, ownership/capability and inventory regressions use synthetic fixtures/isolated databases. Real HTTP GETs and SQLite mode=ro were used only for the diagnostics above. No live UYAP requests, imports or downloads.
Candidate package must carry matching EXE/UI commit and sidecar hashes. Live replacement and WebView2 reopen require a separate scoped approval; rollback uses the previous UI/package backup. No Core restart or DB migration is part of this UI revision.
