# General CBS document response adapter

## Scope and evidence

`bridge/uyap_cbs_document_parser.js` implements `bono.cbs-document-list.v1`.
The existing Core metadata contract exports `parseCbsDocumentList`; this is a
pure review entry point, not a new HTTP route or executor. Existing court
validation, query delivery, import gates, queue and observer code are unchanged.

Evidence: the user supplied a DevTools-confirmed response contract for POST
`/list_dosya_evraklar.ajx`, HTTP 200, `text/json`. No raw live JSON was included
in this implementation's input. Fixtures are independently generated synthetic
records, not anonymized copies of a real case. Tests establish parser behavior,
not live capture, identity lifetime, complete pagination or download capability.

## Supported response

- Required success envelope: object, HTTP 200 and application `status: 200`.
  Known application errors, including `PRTL_GNL_1-1`, fail closed.
- `tumEvraklar`: dynamic group map of main-record arrays; group count is unbounded
  by any case-specific rule. Non-array group values are reported as partial;
  unknown nested schemas are not guessed or flattened.
- `son20Evrak`: existing array representation is an alternate view. Other shapes
  are explicitly unsupported/partial. Counts remain separate from the full view.
- `pageTotal`: retains the observed integer. Its pagination meaning is unknown;
  neither this number nor successful parsing proves all pages were captured.
- Main metadata: `evrakId`, `dosyaId`, `ggEvrakId`, `birimEvrakNo`,
  `onaylandigiTarih`, `sistemeGonderildigiTarih`, `gonderenDosyaNo`,
  `gonderenSayi`, `tur`, `tip`, `isYetkili`, and `ekEvrakListesi`.
- `gonderenYerKisi` and `aciklama` are recognized but their values are omitted
  deliberately. Only their presence is recorded. Unknown properties, secrets,
  raw errors, document contents and free group labels are not copied.
- Attachment metadata: `anaEvrakId`, `evrakId`, `sira`, `ekTuru`. An explicitly
  present `dosyaId` is retained; its presence is not assumed for attachments.

Opaque string IDs retain their exact characters, including quotes and spaces.
No normalization, token alias, title-based matching or legacy ID equivalence is
performed. Unsupported identifier types are unresolved, not string-coerced.
All parser output is local legal metadata and must not enter telemetry/logs.

## Source, occurrences and related cases

Every main/attachment appearance is a separate occurrence with view, group,
parent occurrence and source fields. `reportedParentId` is the original
`anaEvrakId`, not an inferred equality with its parent's opaque `evrakId`.
Attachments without source IDs remain unknown. Same-group records can have
different source IDs; a group label is only a strictly parsed display number/type.

Exact `[dosyaId, evrakId]` pairs link occurrences into a logical document across
groups and views. JSON tuple keys avoid delimiter collisions. Original occurrence
metadata is preserved even when views disagree; no occurrence overwrites another.
Unknown-source attachments are not deduplicated. Main, attachment and recent-view
occurrence counts are distinct from logical identity counts and physical files.
Physical file count and SHA-256 stay unknown; integrity is never asserted.

PR #21 and PR #24 (`bono.linked-legal-cases.v1`) were reviewed. Source
`uyapDosyaId/evrakId` and `visibleFromUyapDosyaId` are separate. A trusted PR17
case identity plus a causal panel/request/response tuple can establish a matching
source for the target itself. It does not verify a relationship to other cases.
Groups remain `unknown`; `selectGroupsForReview` produces
`user_selected_unverified` display choices without changing source ownership.
No case nodes, legal edges, migrations or default related-case traversal are
created. A later PR24 adapter must retain these exact IDs rather than applying
its current trimming/delimiter normalization blindly.

## Integration and gates

Use the pure Core entry point:

```js
const {parseCbsDocumentList} = require('./uyap_case_document_contract');
const review = parseCbsDocumentList(response, trustedCaptureContext);
```

`trustedCaptureContext` is supplied by Core, never by response JSON. It includes
HTTP status, capture completeness, PR17 case identity, causal panel evidence and
request/response event, panel, tab, frame, page-document and exact file IDs.
Missing proof or any mismatch produces a diagnostic. Timing alone is not proof.
This adapter evaluates supplied evidence; it does not manufacture capture proof.

Separate states describe file-query evidence (unknown to this parser), document
request success, parsing, binding/source ownership, import and physical integrity.
Parsed metadata can be inspected without allowing import. The existing production
CBS import gate stays closed even for a synthetically verified tuple. There is no
automatic invocation from query execution and no new executable endpoint.

The smallest remaining live integration prerequisite is a complete real response
paired with the **same verified target panel and request context**. For related
sources, independent file relationship evidence remains necessary. Attachments
without their own source/reference evidence remain unresolved. Download references
and pagination semantics must be verified separately; `isYetkili` does not supply
a download URL or permission grant. Reported denial is retained explicitly.

No live installation, metadata transfer, download or pause change was performed.
Enabling those stages requires separate authorization and existing safety checks.

## Validation

New test: `node scripts/test_uyap_cbs_document_parser.js` — 25 synthetic cases:
dynamic CBS/instruction groups, mixed sources, attachments/repeated appearances,
recent-view linking, empty vs not queried, HTTP-200 denial, malformed/partial
JSON, privacy, exact quoted IDs, ambiguous labels, wrong/stale/concurrent context,
selection without verification, and readable output with import still denied.

Regressions: PR17 case/document contract, CBS evidence and list adapter, CBS user
query integration, user-query migration/queue policy, extension, abrupt process
exit, session checks, Core–Bridge E2E, capability diagnostics, three WebView2/API
suites, rate limits and batch safety. All run against synthetic temporary DBs;
there is no live portal executor. The abrupt-exit fixture was updated to supply
the required fresh queue count; production migration checks were not weakened.

Rollback is an isolated code revert; there is no schema/data migration or live
installation to undo.
