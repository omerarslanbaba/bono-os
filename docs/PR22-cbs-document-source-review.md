# CBS source review after command 17616

## Read-only live findings (2026-10-09)

Command 17613 and command 17616 each retained a full CBS list result with the same exact unit/file number, but different opaque `dosyaId` strings. Both results remain in history. Current case 93 matches the latter. Opaque-ID lifetime, session scope and equivalence are unknown: no decryption, conversion or permanent alias is justified.

The installed baseline's `cbs.search` result handler calls `upsertCasesFromSearch` before the user-query `afterResult` policy checks identity. This explains why a different ID can be written before that check compares the case. The repository already has an explicit-CBS branch that skips bulk upsert; that branch was not present in the installed older baseline. The successful transport test is real, but does not prove immutable identity or correct guard ordering in that baseline. This change does not alter/install the transport or either result handler.

Read-only audit: BONO case ID, external ID and office-file link unchanged; one current case-query binding; zero remote documents for case 93. No existing remote-document rows therefore require relinking for this case. Older command results retain the older ID; the current binding is not historical evidence for it. Other cases' links are not audited or changed.

## Isolated implementation

- `uyap_cbs_document_evidence` reviews the existing sanitized observation identity graph. References remain session-keyed pseudonyms, never raw UYAP IDs. Groups use event-specific references so a selection from an older response cannot select a similarly positioned new group.
- Group, subgroup and leaf edges remain separate. A missing leaf source is never inherited from its group or panel. Equality of two pseudonyms is reported as equality only, not legal ownership. Arbitrary descriptions, names and content are not copied.
- Existing observer status/popup offers local review selections; no selection starts a request or grants import/download permission. All groups start unchecked while semantics remain unknown.
- Existing read-only query-support response provides an identity-history audit. The current case UI shows a short warning when recorded IDs differ. No queue/history schema migration, rewriting, aliasing or query execution change.

The 23 categories and displayed sum 51 are visible UI evidence for a labelled subtree, not 51 verified document IDs. The other visible labels (2026/51962, 2026/11706, 2026/9621) remain separate; their source IDs and legal relationship are unknown.

## Exact remaining evidence

A single complete, correlated real Evrak response with request identity matching the fresh target context, including source/group/child identity fields and actual view/download references. The existing graph observes only already known `dosyaId`/`evrakId` fields: unknown field names are not invented. An async request that lacks existing causal proof remains rejected. Empty/cached/no-event observations do not justify a second request.

This review mechanism does not yet enable executable CBS document listing or metadata import. A new parser cannot safely be completed from UI counters alone. User review selection cannot replace missing source evidence. The observation-only popup is not claimed as the requested future automatic BONO document workflow.

Physical download remains blocked for CBS. Existing verified-document picker defaults to selected only after the existing Core proof gate provides eligible rows; existing local-asset rows are excluded. No filename-based deduplication or matching a new opaque ID to an old physical file is introduced. Reuse must require verified source binding and actual stored hash/file integrity, not merely a previous download status. Actual CBS download-reference semantics must first be observed.

## Approval boundary / rollback

Nothing installed; normal e4de47d remains running. No live request, metadata write, download, pause change or process restart in this task. Reverting this commit removes review diagnostics and selection UI without data migration. Source/metadata import and physical download remain separate later approvals. Before a live observation, installation must be separately prepared/hash-checked; do not enable a CBS adapter or replay a search as part of that installation.

Tests use synthetic graph shapes solely to test evidence handling, not to claim the real CBS response schema. Real identity audit results stay in local outputs with raw IDs omitted.
