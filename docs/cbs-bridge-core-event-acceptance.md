# PR #23 — Bridge → Core CBS event acceptance (isolated contract)

Run: `node --test scripts/cbs_event_acceptance.test.cjs`.

## Read-only inspection

- `extension/content.js` relays page-probe network observations through `BONO_CAPTURE`; `extension/background.js` receives sender tab/frame metadata but forwards `capturedAt`, `sourceUrl`, and `payload` to `POST /events`. The observed forwarding body does not preserve a verified tab/frame/panel/page-document provenance envelope.
- `bridge/server.js` `POST /events` reduces network telemetry and calls `uyap.observe`, then appends event summaries to a local event log. This is an observation path; successful HTTP 202 is not authenticated binding of response to a case or panel.
- `bridge/observation_controller.js` is **absent** from the PR #23 base checkout. No claim that its intended validation is currently implemented.
- The true UYAP endpoint is `POST /list_dosya_evraklar.ajx`. Known response *field names* are `tumEvraklar`, `son20Evrak`, `pageTotal`, `status`. Fixture status value `200` is synthetic and **not** an assertion about UYAP's real application-status semantics.

## Isolated fail-closed test contract

The fixture-only `cbs_event_acceptance_model.cjs` requires session/tab/frame/panel/page-document/request binding, connectivity, complete top-level field presence, duplicate rejection, and a HMAC reference that is independent of any UYAP document identity. It emits strictly allowlisted telemetry. It does **not** modify, intercept or invoke real Bridge, Core or Chrome paths.

The HMAC observation reference is an event correlation/dedup value, **not** an `evrakId`, `ggEvrakId`, `anaEvrakId`, `dosyaId` or legal document key. HMAC alone proves no authority or document ownership.

## Integration requirements

1. Implement a real trusted observation envelope and bind request to active session + sender tab/frame + panel + page navigation epoch before accepting any response.
2. Establish a reliable request-to-response correlation and idempotent event replay policy. On disconnect, expiration or navigation, invalidate correlation.
3. Normalize *verified* application-status rules only after evidence from PR #22; a transport success is not application success.
4. Preserve the verified source `dosyaId` and parent/attachment ownership as separate metadata, never derive from group heading or observation HMAC.
5. Protect persisted request summaries, logs, errors and telemetry with strict allowlists and explicit secret/opaque identifier scanning. Current raw sample handling needs independent privacy review before any case-sensitive response is forwarded.
6. Run boundary tests against the eventual production observation controller and `/events` handler using injected fake sender contexts. Do not interpret this synthetic model passing as production end-to-end acceptance.

No PR #22 files, live UYAP, Core process, DB, or Chrome extension are changed.

