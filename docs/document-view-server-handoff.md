# Document View — Chat-Sync Server Handoff

Target UI commit: `c3f696ea2c35eee16dd92873fd1710fe463847e6`
Archive branch: `feature/archive-engine`

Bu handoff `bridge/server.js` sahibine uygulanabilir entegrasyon tarifidir. Chat-Archive `server.js` dosyasını değiştirmez.

## Hazır modüller

- `bridge/document_view_service.js` — case-scoped metadata / readability / viewer state
- `bridge/document_stream_guard.js` — fiziksel stream için asset binding, symlink ve fd-hash güvenliği
- `bridge/document_view_http.js` — iki route'un HTTP adapter'ı ve stream/header davranışı

## server.js değişikliği

### 1. Import

`bridge/server.js` üst import bölümüne:

```js
const documentViewHttp=require("./document_view_http");
```

### 2. Route delegation

`http.createServer(...)` içinde `const p=u.pathname;` sonrasında, normal API route'larından önce:

```js
if(documentViewHttp.handleDocumentViewRequest(req,res,db)) return;
```

Başka stream kodu yazılmamalıdır. Özellikle canonical `path` yeniden açılıp doğrudan stream edilmemelidir. Adapter canonical kaynağı case/asset/symlink kontrollerinden geçirir, doğrulanan byte’ları özel bir geçici snapshot’a kopyalarken SHA-256 hesaplar ve response’u yalnız bu doğrulanmış snapshot fd’sinden stream eder.

## Route sözleşmesi

### Metadata / view

`GET /api/cases/:caseId/documents/:remoteDocumentDbId/view`

Başarılı cevap:
- `ok: true`
- `document.caseId`
- `document.remoteDocumentDbId`
- `document.name`
- `document.documentType`
- `document.documentDate`
- `document.case.court`
- `document.case.courtFileNo`
- `document.case.officeFileId`
- `document.download`
- `document.integrity`
- `document.readability`
- `document.viewer`

### Physical content

`GET /api/cases/:caseId/documents/:remoteDocumentDbId/content`

Content yalnız şu şartlarda stream edilir:
1. remote document aynı `caseId` altında bulunur;
2. `local_asset_id` vardır;
3. canonical path absolute ve fiziksel olarak vardır;
4. canonical path aynı asset'in `asset_locations` kaydında birebir vardır;
5. path bileşenlerinde symlink/junction policy ihlali yoktur;
6. dosya regular file'dır;
7. canonical kaynak fd’sinden özel snapshot oluşturulurken hesaplanan SHA-256 beklenen asset/remote SHA ile aynıdır;
8. HTTP response yalnız doğrulanmış snapshot fd’sinden stream edilir ve response kapanınca snapshot temizlenir.

## UI `c3f696e` birebir alan uyumu

Chat-UI `bindCaseDocumentViewer()` şu alanları okur:

| UI beklentisi | Backend alanı | Durum |
|---|---|---|
| `response.ok === true` | root `ok` | Uyumlu |
| `response.document.caseId` | `document.caseId` | Uyumlu |
| `response.document.remoteDocumentDbId` | `document.remoteDocumentDbId` | Uyumlu |
| `download.downloaded` | `document.download.downloaded` | Uyumlu |
| `integrity.verified` | `document.integrity.verified` | Uyumlu |
| `integrity.exists` | `document.integrity.exists` | Uyumlu |
| `readability.readable` | `document.readability.readable` | Uyumlu |
| `readability.text` | `document.readability.text` | Uyumlu |
| `readability.error` | `document.readability.error` | Uyumlu |
| `readability.status` | `document.readability.status` | Uyumlu |
| `viewer.openable` | `document.viewer.openable` | Uyumlu |
| `viewer.mode` | `document.viewer.mode` | Uyumlu |

UI'nın fiziksel içerik gate'i:

```js
viewer.openable===true && integrity.verified===true && integrity.exists===true
```

`document_view_http.js` `/view` çağrısında stream guard'ı da çalıştırır. Symlink, asset-location mismatch veya stream-level SHA sorunu varsa `viewer.openable=false` yapılır ve `endpoints.content=null` döner. UI ek bir alan okumasa da güvenli biçimde bloklanır.

## Viewer davranışı

### PDF
- `viewer.mode = pdf_inline`
- `Content-Type: application/pdf`
- `Content-Disposition: inline; filename=...; filename*=UTF-8''...`
- UI iframe ile açar.

### UDF
- extraction varsa `viewer.mode = udf_text`
- UI metni `readability.text` üzerinden gösterir.
- raw UDF content endpointi:
  - `Content-Type: application/octet-stream`
  - `Content-Disposition: attachment; filename=...; filename*=UTF-8''...`
- UI `c3f696e` text-mode UDF için otomatik raw-download linki göstermiyor; backend route hazırdır ve bu UI uyumsuzluğu değildir.

### Diğer verified formatlar
- image: uygun MIME ile inline
- diğerleri: `application/octet-stream` veya bilinen MIME + attachment

## Güvenli dosya adı

`document_view_http.contentDisposition()`:
- CR/LF ve kontrol karakterlerini temizler;
- `/`, `\\`, `:` gibi path/header açısından sakıncalı karakterleri `_` yapar;
- ASCII fallback `filename=` üretir;
- UTF-8 isim için RFC5987 `filename*=` üretir.

## Hata sözleşmesi

| Durum | HTTP | Error |
|---|---:|---|
| Belge başka case'te / yok | 404 | `document_not_found_in_case` |
| Local asset indexlenmemiş | 409 | `canonical_asset_not_indexed` |
| Canonical dosya yok | 409 | `canonical_file_missing` |
| Canonical path asset location'a bağlı değil | 409 | `canonical_asset_location_mismatch` |
| Symlink/junction policy engeli | 409 | `canonical_symlink_rejected` |
| Regular file değil | 409 | `canonical_not_regular_file` |
| SHA yok / mismatch | 412 | `canonical_hash_not_verified` |

## Path traversal

HTTP route regex yalnız pozitif numeric `caseId` ve `remoteDocumentDbId` kabul eder. Fiziksel path request parametresinden alınmaz. Canonical path yalnız DB'deki declared `filed_path/archive_path` üzerinden seçilir ve relative path kabul edilmez.

## Symlink / reparse-point

`document_stream_guard.hasSymlinkComponent()` canonical path bileşenlerini `lstat` ile kontrol eder. Symlink path stream edilmez. Windows junction davranışı fixture ortamında desteklendiği ölçüde aynı policy kapsamındadır.

## TOCTOU koruması

`/view` sırasında yapılan hash doğrulamasına güvenilmez. `/content` çağrısında canonical kaynak yeniden case/asset/symlink kontrollerinden geçirilir ve açılır.

Ardından:
1. canonical source fd'den byte'lar yalnız BONO'nun oluşturduğu özel temp snapshot'a yazılır;
2. SHA-256 aynı byte akışı üzerinde hesaplanır;
3. hash uyuşmazsa snapshot silinir ve 412 döner;
4. hash doğruysa canonical source fd kapatılır;
5. HTTP response yalnız doğrulanmış snapshot fd'sinden stream edilir;
6. stream/response kapanınca snapshot dizini temizlenir.

Bu, iki ayrı yarışı kapatır:
- `/view` ile `/content` arasında canonical dosyanın değiştirilmesi;
- SHA doğrulamasından **sonra** canonical dosyanın yerinde değiştirilmesi.

İkinci durumda bile response byte'ları artık canonical kaynaktan değil, hash'i doğrulanmış snapshot'tan geldiği için doğrulanmamış içerik kullanıcıya gönderilmez.

## Desktop WebView2 proxy uyumu

`LocalPreviewServer.cs` `/api/{**path}` yanıt header'larını Core'dan WebView2'ye taşır. `Content-Type`, `Content-Disposition`, `Cache-Control`, `X-Content-Type-Options` ve `X-BONO-Verified-SHA256` forward edilir.

Not: proxy `Content-Length` header'ını kendi hop-by-hop filtre listesinde çıkarıyor. Stream çalışması için engel değildir; UI bu header'a bağlı değildir.

## Entegrasyon sonrası çalıştırılacak test

```text
node scripts/document_view_http_selftest.js
node scripts/document_view_service_selftest.js
node scripts/test_web_desktop_case_ui.js
```

HTTP fixture canlı Core veya gerçek DB kullanmaz; loopback ephemeral server + in-memory SQLite + temp dosyalar kullanır. Fixture ayrıca verified snapshot oluşturulduktan sonra canonical kaynağı değiştirip stream byte’larının değişmediğini ve snapshot cleanup’in tamamlandığını doğrular.
