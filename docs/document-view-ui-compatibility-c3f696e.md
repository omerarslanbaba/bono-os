# Document View API Compatibility — Chat-UI c3f696e

Target UI commit: `c3f696ea2c35eee16dd92873fd1710fe463847e6`

Backend preparation branch: `feature/archive-engine`

Status: **compatible in isolated HTTP fixture**

## UI API calls

Chat-UI defines:

```js
caseDocumentView:(caseId,documentId)=>request('/api/cases/'+encodeURIComponent(caseId)+'/documents/'+encodeURIComponent(documentId)+'/view')
caseDocumentContentUrl:(caseId,documentId)=>'/api/cases/'+encodeURIComponent(caseId)+'/documents/'+encodeURIComponent(documentId)+'/content'
```

Backend adapter matches these exact paths.

## UI field contract

| Chat-UI c3f696e access | Backend field | Required meaning | Result |
|---|---|---|---|
| `response.ok` | root `ok` | metadata request succeeded | PASS |
| `document.caseId` | `document.caseId` | current BONO case | PASS |
| `document.remoteDocumentDbId` | `document.remoteDocumentDbId` | clicked UYAP remote DB row | PASS |
| `document.name` | `document.name` | visible evrak name | PASS |
| `document.documentType` | `document.documentType` | UYAP/document type | PASS |
| `document.documentDate` | `document.documentDate` | UYAP document date | PASS |
| `download.downloaded` | `document.download.downloaded` | local/download state | PASS |
| `integrity.exists` | `document.integrity.exists` | canonical physical file exists | PASS |
| `integrity.verified` | `document.integrity.verified` | canonical SHA verified | PASS |
| `readability.readable` | `document.readability.readable` | extracted text available | PASS |
| `readability.text` | `document.readability.text` | extracted text | PASS |
| `readability.error` | `document.readability.error` | explicit extraction error | PASS |
| `readability.status` | `document.readability.status` | extraction state | PASS |
| `viewer.openable` | `document.viewer.openable` | physical viewer gate | PASS |
| `viewer.mode` | `document.viewer.mode` | pdf_inline / udf_text / etc. | PASS |

Additional backend fields (`case`, `uyap`, SHA values, `streamSafe`, `streamBlockReason`, references, endpoints) are additive and do not break the UI.

## UI physical content gate

Chat-UI opens content only when:

```js
viewer.openable===true && integrity.verified===true && integrity.exists===true
```

`document_view_http.js` additionally executes the stream guard during `/view`. If the file is symlinked, no longer bound to the asset location, or fails stream-level verification:
- `integrity.streamSafe=false`
- `viewer.openable=false`
- `viewer.mode='blocked'`
- `endpoints.content=null`

Therefore the existing UI gate remains safe without requiring UI changes.

## PDF compatibility

Expected by UI:
- `viewer.mode='pdf_inline'` -> iframe to `/content`

Backend:
- `Content-Type: application/pdf`
- `Content-Disposition: inline`
- RFC5987 UTF-8 `filename*=`
- `Cache-Control: no-store`
- `X-Content-Type-Options: nosniff`
- `X-BONO-Verified-SHA256`

Result: **PASS**.

## UDF compatibility

Expected by UI:
- `viewer.mode='udf_text'` -> render `readability.text`

Backend:
- UDF text is returned in metadata when extraction succeeded;
- raw UDF `/content` is available as `application/octet-stream` + `attachment`;
- UI c3f696e does not need raw UDF link for text-mode viewing.

Result: **PASS**.

## Error / security compatibility

| Scenario | `/view` | `/content` | UI effect |
|---|---|---|---|
| wrong case | 404 | 404 | viewer error, no content leak |
| canonical missing | metadata with blocked viewer | 409 | no physical open |
| hash mismatch | blocked / unverified | 412 | no physical open |
| symlink/junction policy | blocked viewer | 409 | no physical open |
| asset-location mismatch | blocked viewer | 409 | no physical open |
| unreadable but hash-verified PDF | readable=false, pdf_inline=true | 200 raw PDF | PDF can still be visually inspected |
| post-view file mutation | later content re-verifies | 412 | changed file blocked |
| post-hash canonical mutation | verified snapshot unaffected | verified snapshot bytes only | unverified bytes never streamed |

## Isolation test

`scripts/document_view_http_selftest.js` runs:
- ephemeral loopback Node HTTP server;
- in-memory SQLite;
- temporary fixture files;
- no live BONO DB;
- no live Core;
- no UYAP;
- no Dava Dosyaları.

Current suite contains **23 HTTP/security assertions** and must report `failed: 0`.

## Chat-Sync integration dependency

Chat-Sync only needs to delegate the two GET routes to `bridge/document_view_http.js` as documented in `docs/document-view-server-handoff.md`. No UI payload translation layer is required.
