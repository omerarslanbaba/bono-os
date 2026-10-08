# Case Document Review & Drafting Source Contract

Contract version: `case-document-review-v0.1`

Bu sözleşmenin amacı bir dava dosyasındaki evrakları dilekçe hazırlama motoruna verirken her içerik parçasının hangi somut belgeye ait olduğunu kaybetmemektir.

## Temel ilkeler

1. Arşivlenmiş olmak okunabilir olmak değildir.
2. Metni çıkarılmış olmak canonical dosyanın doğrulandığı anlamına gelmez.
3. Dilekçe corpus'una yalnız `reviewReady=true` belgeler girer.
4. `reviewReady` için hem metin extraction başarılı olmalı hem canonical SHA-256 doğrulaması geçmelidir.
5. Okunamayan veya doğrulanamayan içerik tahmin edilmez.
6. İki farklı evrak aynı ada sahip olsa bile source identity birleşmez.
7. Başka case'e ait content hiçbir koşulda current case corpus'una eklenmez.
8. Alıntı veya türetilmiş her bilgi `sourceRef` ile somut evraka bağlanmalıdır.

## Case review modeli

```json
{
  "case": {
    "id": 123,
    "officeFileId": 45,
    "court": "...",
    "courtFileNo": "2026/100",
    "uyapDosyaId": "..."
  },
  "documents": [
    {
      "sourceId": "uyap-remote:777",
      "remoteDocumentDbId": 777,
      "remoteDocumentId": "UYAP-EVRAK-ID",
      "assetId": 900,
      "name": "Duruşma Zaptı",
      "documentType": "Duruşma Zaptı",
      "normalizedKind": "duruşma_tutanağı",
      "documentDate": "2026-10-08",
      "uyap": {
        "caseDbId": 123,
        "dosyaId": "UYAP-DOSYA-ID",
        "remoteDocumentId": "UYAP-EVRAK-ID",
        "portalUrl": null,
        "internalCaseDocumentsEndpoint": "/api/uyap/cases/123/remote-documents"
      },
      "contentEndpoint": "/api/assets/900/content",
      "canonical": {
        "path": "...",
        "exists": true,
        "verified": true,
        "sha256": "...",
        "expectedSha256": "...",
        "reason": null
      },
      "reviewReady": true,
      "extraction": {
        "status": "extracted",
        "engine": "pdftext-v0.9",
        "readable": true,
        "text": "...",
        "references": []
      }
    }
  ],
  "unreadable": []
}
```

## Extraction status

- `extracted`: gerçek text mevcut.
- `no_text`: dosya açıldı ancak embedded text çıkarılamadı. Image-only PDF/TIFF için tipik durum.
- `failed`: parser dosyayı okuyamadı veya belge bozuk.
- `not_analyzed`: henüz analysis sonucu yok.
- `unverified`: text var fakat canonical physical file SHA doğrulaması geçmedi.
- `verification_pending`: hash doğrulaması özellikle devre dışı bırakılmış.

Bu statüler birbirinin yerine kullanılmaz.

## Kaynak referansları

### PDF

```json
{
  "sourceRef": "uyap-remote:777:chunk:1000",
  "kind": "page",
  "page": 2,
  "heading": "Sayfa 2",
  "chunkNo": 1000,
  "text": "..."
}
```

PDF kaynaklarında page metadata mevcutsa sayfa numarası zorunlu olarak korunur.

### UDF

```json
{
  "sourceRef": "uyap-remote:778:section:2",
  "kind": "section",
  "page": null,
  "heading": "AÇIKLAMALAR",
  "startParagraph": 14,
  "text": "..."
}
```

UDF motorunda güvenilir fiziksel sayfa numarası yoktur. Sayfa uydurulmaz; bölüm, paragraph veya chunk referansı kullanılır.

## Drafting corpus

`buildDraftingCorpus(review)` şu modeli üretir:

```json
{
  "contractVersion": "case-document-review-v0.1",
  "sourceDocuments": [],
  "sourceUnits": [],
  "unreadableDocuments": [],
  "rules": {
    "neverMergeSourceIdentity": true,
    "requireSourceRefForQuotedOrDerivedContent": true,
    "pageReferenceWhenAvailable": true,
    "doNotInferUnreadableContent": true
  }
}
```

### sourceDocuments
Belge seviyesindeki provenance:
- sourceId
- belge adı
- normalized kind
- UYAP tarihi
- remote document DB ID
- asset ID
- canonical path
- verified SHA-256
- UYAP identifiers

### sourceUnits
Dilekçe hazırlama motoruna verilebilecek en küçük kaynaklı içerik birimi:
- sourceRef
- sourceId
- group
- documentKind
- documentName
- documentDate
- page veya heading
- chunkNo
- text

Gruplar:
- `hearing_minutes`
- `pleadings`
- `expert_reports`
- `decisions`
- `other`

## Dilekçe hazırlama kuralları

Bir sonraki AI/drafting katmanı:
- belge adından içerik tahmin etmemeli;
- `unreadableDocuments` içeriğini hukuki vakıa gibi kullanmamalı;
- aynı isimli evrakları sourceId üzerinden ayrı tutmalı;
- alıntı/özet her zaman sourceRef taşımalı;
- PDF'te mümkünse sayfa numarası göstermeli;
- UDF'te bölüm/paragraf/chunk referansı göstermeli;
- farklı case sourceId'lerini current case corpus'una eklememeli;
- canonical SHA doğrulanmamış belgeyi evidence/drafting text kaynağı olarak kullanmamalıdır.

## Container belgeleri

ZIP/EYP parent kaydı doğrudan dilekçe text kaynağı değildir.

Başarılı extraction sonrası:
- her faydalı PDF/UDF üye kendi asset / derived remote record kimliği ile review edilir;
- parent yalnız provenance (`sourceContainer` / `derivedFrom`) sağlar;
- parent package'ın içeriği tek bir metinmiş gibi birleştirilmez.

## UYAP URL sınırı

Mevcut veri modelinde kalıcı portal deep-link yoktur. `portalUrl` bu nedenle bilerek `null` tutulur. `uyap_dosya_id`, remote document ID ve BONO internal endpoint kaynak bağı için kullanılır. Sistem doğrulanmamış bir UYAP URL'si üretmemelidir.
