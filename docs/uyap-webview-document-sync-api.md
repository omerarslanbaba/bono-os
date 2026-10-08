# UYAP WebView2 single-case document sync API v1

## GET /api/uyap/cases/:caseId/document-sync-status

Response contract: `uyap.document-sync.v1`.

Stable fields:

```json
{
  "contractVersion": "uyap.document-sync.v1",
  "caseId": 123,
  "requestedCaseId": 123,
  "uyapDosyaIdPresent": true,
  "state": "queued",
  "label": "Evrak listesi sorgusu bekliyor",
  "terminal": false,
  "success": false,
  "requiresLogin": false,
  "active": true,
  "pollAfterMs": 1500,
  "canSync": false,
  "command": {
    "id": 456,
    "status": "queued",
    "priority": 6,
    "attempts": 0,
    "maxAttempts": 5,
    "createdAt": "...",
    "dispatchedAt": null,
    "finishedAt": null,
    "error": null
  },
  "documents": {
    "remoteCount": 0,
    "physicalCount": 0,
    "resultCount": null,
    "hasResultPayload": false
  },
  "freshness": {
    "stale": true,
    "staleAfterMinutes": 30
  },
  "session": {
    "state": "ready",
    "manualDownloadPaused": true
  }
}
```

### States

- `not_synced`: no document.list command exists for the case.
- `queued`: command exists and has not been dispatched.
- `running`: the Chrome executor has claimed the command.
- `completed`: UYAP returned a non-empty document payload and metadata is bound to `uyap_remote_documents`.
- `empty`: completed UYAP request returned a verified empty document list.
- `failed`: terminal command failure or completed command without usable result payload.
- `login_required`: Core is waiting for the user's Chrome UYAP session.
- `metadata_unbound`: UYAP returned document metadata but no remote rows were bound to the case.
- `unlinked`: requested BONO case does not resolve to a UYAP-linked case.

`command.id` is the authoritative command identity. The flat `commandId` field remains temporarily for backward compatibility.

Only `completed` and `empty` have `success=true`.
`terminal=true` for completed, empty, failed, metadata_unbound and unlinked.
`login_required` is not treated as success; UI must wait for explicit user login.

## POST /api/uyap/cases/:caseId/sync-documents

Accepted response:

```json
{
  "ok": true,
  "accepted": true,
  "id": 456,
  "commandId": 456,
  "sync": { "...": "uyap.document-sync.v1" }
}
```

HTTP 202 means only **accepted/queued**. It does not mean the UYAP query completed.

The WebView2 client must poll the GET status endpoint using `pollAfterMs` while state is queued or running and show terminal success only after `completed` or `empty`.

## GET /api/uyap/case-search-schema

Response contract: `uyap.case-search-schema.v1`.

This endpoint is read-only and never sends a UYAP request. It inspects previously captured `uyap_endpoint_observations` for the configured `case.search` path.

Until a real `/search_phrase_detayli.ajx` request is observed:

```json
{
  "state": "observation_required",
  "observed": false,
  "targetedSearch": {
    "ready": false,
    "requiredInputs": ["court", "year", "baseNumber"],
    "reason": "request_schema_not_observed"
  },
  "liveQueryRequired": true
}
```

Even after a request shape is observed, targeted search remains disabled until the court/year/base-number fields are mapped from a real observed UYAP interaction. No payload is guessed.
