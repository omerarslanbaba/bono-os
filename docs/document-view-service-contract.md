# BONO OS Document View Service Contract

Bu sözleşme indirilen ve doğrulanmış UYAP evraklarının BONO OS dosya detayından güvenli biçimde açılması için hazırlanmıştır.

Bu branch `bridge/server.js` veya çalışan Core'u değiştirmez. Sözleşme ve bağımsız servis gelecekte UI/Core entegrasyonu için hazırdır.

## Neden mevcut global asset endpointi yeterli değil?

Mevcut Core endpointi:

`GET /api/assets/:assetId/content`

asset ID üzerinden fiziksel dosyayı stream eder. Bu endpoint case bağlamı istemediği için dosya detay UI'sının ana erişim yolu olmamalıdır. Bir asset'in hangi dava ekranından açıldığı ayrıca doğrulanmalıdır.

Yeni UI case-scoped sözleşmeyi kullanmalıdır.

## Önerilen salt-okunur endpointler

### Belge görüntüleme metadata'sı

`GET /api/cases/:caseId/documents/:remoteDocumentDbId/view`

Bu endpoint:
- yalnız `caseId + remoteDocumentDbId` birlikte eşleşirse belgeyi döndürür;
- başka case'e ait remote document ID için `404 document_not_found_in_case` döndürür;
- başka davada aynı belge/hash mevcut olsa bile onu current case belgesi gibi göstermez;
- fiziksel dosyaya yazmaz;
- DB'ye yazmaz;
- download kuyruğunu değiştirmez.

### Doğrulanmış fiziksel içerik

`GET /api/cases/:caseId/documents/:remoteDocumentDbId/content`

Bu endpoint metadata servisindeki case ownership ve SHA kontrolünden sonra stream izni verir.

Önerilen hata davranışı:
- `404 document_not_found_in_case`: belge bu case'e ait değil veya yok;
- `409 canonical_file_missing`: canonical fiziksel dosya yok;
- `409 document_not_openable`: format/view state açılamıyor;
- `412 canonical_hash_not_verified`: dosya var fakat SHA doğrulaması geçmedi.

Yanlış case için asset veya belge varlığına ilişkin ek bilgi döndürülmez.

## Hazır bağımsız servis

`bridge/document_view_service.js`

API:
- `getDocumentView(db, caseId, remoteDocumentDbId, opts)`
- `authorizeDocumentContent(db, caseId, remoteDocumentDbId)`
- `viewerState(document)`

Servis yalnız SELECT/read işlemleri için tasarlanmıştır.

## UI veri modeli

Örnek:

```json
{
  "document": {
    "caseId": 1,
    "remoteDocumentDbId": 11,
    "name": "Gerekçeli Karar",
    "documentType": "Gerekçeli Karar",
    "documentDate": "2026-10-01",
    "download": {
      "downloaded": true,
      "remoteStatus": "filed",
      "localAssetIndexed": true,
      "canonicalPresent": true
    },
    "integrity": {
      "canonicalPath": "...",
      "exists": true,
      "verified": true,
      "sha256": "...",
      "expectedSha256": "...",
      "reason": null
    },
    "readability": {
      "status": "extracted",
      "readable": true,
      "engine": "pdftext-v0.9",
      "error": null,
      "text": "...",
      "references": []
    },
    "viewer": {
      "mode": "pdf_inline",
      "openable": true,
      "contentType": "application/pdf",
      "disposition": "inline",
      "textReadable": true
    }
  }
}
```

## Üç durum birbirinden ayrı gösterilmelidir

UI tek bir `Hazır` etiketi kullanmamalıdır.

### 1. Download durumu
- UYAP'tan indirilmiş mi?
- local asset indexlenmiş mi?
- canonical dosya var mı?

### 2. Bütünlük durumu
- canonical path var mı?
- fiziksel dosya mevcut mu?
- SHA beklenen değerle eşleşiyor mu?

### 3. Okunabilirlik durumu
- text extraction tamamlandı mı?
- text gerçekten var mı?
- parser hata verdi mi?
- OCR mı gerekiyor?

Örnek UI etiketleri:
- `İndirildi`
- `Arşiv doğrulandı`
- `Metin okunabilir`
- `Metin çıkarılamadı`
- `OCR gerekli`
- `Dosya bozuk / analiz başarısız`
- `Bütünlük doğrulanamadı`

## PDF davranışı

Canonical SHA doğrulanmış PDF:
- viewer mode: `pdf_inline`
- content type: `application/pdf`
- disposition: `inline`
- embedded text varsa sağ/alt text panelinde ayrıca gösterilebilir;
- text yoksa PDF yine açılabilir; UI `Metin çıkarılamadı / OCR gerekli` göstermelidir.

Bozuk PDF fiziksel olarak hash doğrulanmış olabilir. Bu durumda:
- dosya kendisi açılmaya çalışılabilir;
- readability `failed` olarak ayrıca gösterilir;
- dosya içeriği tahmin edilmez.

## UDF davranışı

Canonical SHA doğrulanmış UDF:
- native browser inline viewer varsayılmaz;
- extraction mevcutsa viewer mode `udf_text`;
- UI çıkarılmış metni ve bölüm/chunk referanslarını gösterir;
- ham `.udf` dosyası ayrıca attachment/download olarak sunulabilir;
- extraction yoksa `udf_download_only` kullanılır.

UDF için PDF tipi sayfa numarası uydurulmaz.

## Okunamayan / bozuk belge

Metadata her durumda gösterilebilir:
- evrak adı
- tür
- tarih
- ait olduğu dava
- download durumu
- canonical/hash durumu.

Fakat readability ayrı gösterilir:
- `no_text`
- `failed`
- `not_analyzed`
- `unverified`.

UI dosya adından veya evrak türünden içerik üretmemelidir.

## Case ownership

Temel sorgu invariantı:

`WHERE rd.case_id = ? AND rd.id = ?`

Remote document ID tek başına kullanılmaz.

Content stream de metadata servisini bypass etmemelidir. `authorizeDocumentContent()` case ownership + canonical existence + SHA verification geçmeden fiziksel path döndürmez.

## UYAP bağlantısı

Model şu kaynak bağlarını taşır:
- BONO case ID
- `uyap_dosya_id`
- UYAP remote document ID
- BONO remote document DB ID.

Repo'da doğrulanmış sabit UYAP deep-link bulunmadığı için UI sahte portal URL üretmemelidir.

## Kapsam dışı

Bu aşamada özellikle yok:
- dilekçe yazma UI'sı;
- drafting corpus ekranı;
- otomatik hukuki özet;
- OCR implementasyonu;
- Core route değişikliği;
- canlı DB migration.

## Entegrasyon sırası

Core entegrasyonu ileride yapıldığında önerilen sıra:
1. `document_view_service.js` import edilir.
2. `GET /api/cases/:caseId/documents/:remoteId/view` yalnız `getDocumentView()` çağırır.
3. `GET /api/cases/:caseId/documents/:remoteId/content` yalnız `authorizeDocumentContent()` başarılıysa stream eder.
4. UI önce metadata/view endpointini çağırır.
5. `viewer.openable=true` ise content endpointine gider.
6. UI download, integrity ve readability durumlarını ayrı gösterir.
