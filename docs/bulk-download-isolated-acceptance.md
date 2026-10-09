# Isolated bulk-document download acceptance model

These tests use synthetic in-memory bytes and opaque fixture IDs. They do **not** perform an actual download, open a UYAP session, write the archive, mutate DB, or exercise the live Core/Bridge. Production download readiness is **not** established by their passing.

Run: `node --test scripts/bulk_download_acceptance.test.cjs`

## Safety contract under test

* Authorization is explicit per user-requested batch.
* De-duplication key includes target case, source case and document identity; shared hashes never merge document provenance or case links.
* A record may be skipped only with an existing physical, verified checksum match. Metadata or queued state alone does not qualify.
* Failed, partial, empty, corrupt and checksum-mismatched data must be retryable or reported failed; they cannot count as completed.
* Each item's failure is isolated; batch completion requires every authorized item to reach verified state.
* File bytes and hash in the model are synthetic. Real production integrity acceptance additionally requires atomic staging, canonical asset verification, safe path normalization, physical file existence, and verified attachment ownership.

## Required production adapter before integration

1. Map only confirmed document-list fields to `caseId`, `sourceCaseId`, `documentId`; these names are **internal fixture identifiers, not alleged UYAP response fields**.
2. Require actual list completeness and source ownership proofs. Unknown list scope or unverified CBS group relations must fail closed.
3. Integrate with actual queue/pause/manual authorization and idempotency guarantees; do not bypass those controls.
4. Validate physical staging file size/hash/readability before atomic filing and database success transition; restart recovery must reconcile any transaction/file boundary.
5. Verify cases with distinct provenance but equal hashes keep separate links to one canonical content object when supported.
6. Run isolated integration tests against the real download code and a temp-dir fixture archive, then separately authorize any live acceptance.

Do not merge PR #22 observation or queue changes into this test branch.
