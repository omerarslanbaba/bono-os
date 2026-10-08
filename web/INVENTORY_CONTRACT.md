# UI inventory contract v1 (fixture-only)

This is a display contract, **not a server API implementation**.

- A case needs verified UYAP identity before case-specific UYAP actions can be enabled. `uyap_dosya_id` proves only a stored link; it does not prove current authorization or party identity.
- A document list status is `never | failed | partial | complete | unknown`. Only an explicit `complete` plus a successful query timestamp may be rendered as successful. A zero `remote_count` without list evidence is unknown, not an empty list.
- Suggested optional fields from future backend: `document_list_status`, `last_successful_document_query_at`, `pagination_complete`, `source_verified_at`. No client will infer these from queued commands or document counts.
- Download state comes from document-level `local_asset_id` only. Integrity is independent and needs `integrity_status='verified'` or `hash_verified=true` from an authoritative source. Neither stored local asset nor queued download proves verification.
- Notification adapter contract: `id`, `caseId`, `documentId`, `kind`, `createdAt`, `readAt`, `source`, `dedupeKey`; adapter is unavailable until real backend support exists.
- CBS, unsupported workflows, failed API calls, and missing evidence show safe unknown/unavailable states and never trigger speculative calls.
- Fixtures in `scripts/test_ui_inventory.mjs` are synthetic and include no client identifiers.

No server, queue, live DB, or background-scheduling code is changed.
