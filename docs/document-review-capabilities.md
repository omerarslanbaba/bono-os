# BONO OS Document Review Capability Matrix

Bu doküman `feature/archive-engine` üzerindeki mevcut gerçek kabiliyetleri ve eksikleri ayırır. "Arşivlenmiş" olmak "okunabilir" olmak anlamına gelmez.

## Format / kabiliyet matrisi

| Format / belge | Arşiv | Görüntüleme | Metin çıkarma | Kaynak referansı | Mevcut sınır |
|---|---|---|---|---|---|
| PDF (metin tabanlı) | Evet | Evet. `/api/assets/:id/content` PDF'yi `application/pdf` inline verir | Evet. `scripts/index_pdf_library.py` + `pypdf` | Sayfa numarası + chunk | 250 sayfa indexer sınırı; review extractor 500 sayfa |
| PDF (taranmış / image-only) | Evet | Evet | Hayır | Yok | OCR motoru yok. `no_text` olarak raporlanır; içerik tahmin edilmez |
| UDF | Evet, asli `.udf` korunur | Ham dosya endpointten verilebilir; browser-native UDF viewer yok | Evet. `udf_engine.py` content.xml okur | Bölüm / paragraf / chunk | Güvenilir PDF tipi sayfa numarası yok |
| ZIP / EYP | Başarılı member extraction sonrası package kalıcı tutulmayabilir | Parent package review hedefi değil | Parent container için doğrudan metin yok; çıkarılan PDF/UDF üyeler analiz edilir | Derived child remote docs | Package içeriği üye bazında incelenir; parent metni uydurulmaz |
| TIFF / TIF | PDF'e dönüştürülür | Dönüştürülmüş PDF görüntülenebilir | Görüntü ise metin çıkarılmaz | PDF page ancak embedded text varsa | OCR yok |
| JPG / JPEG / PNG | Arşivlenebilir / bazı akışlarda yardımcı format | Tarayıcı MIME desteğine göre | Hayır | Yok | OCR yok |
| HTML / HTM | Archive policy PDF'e dönüştürebilir | PDF sonrası görüntülenebilir | Yeni read-only extractor doğrudan text okuyabilir | Belge seviyesi | Mevcut ana indexer HTML için özel knowledge chunk üretmiyor |
| XLS / XLSX / XLSM | Asıl dosya korunur; opsiyonel PDF preview | Preview PDF kullanılabilir | Hücre bazlı text analyzer yok | Yok | Dilekçe corpus'una güvenilir yapılandırılmış Excel metni verilmiyor |
| DOC / DOCX / RTF | Arşivlenebilir | Endpoint ham dosya verir | Mevcut otomatik text analyzer yok | Yok | Henüz review-readable değil |
| TXT | Arşivlenebilir | Ham içerik | Yeni review extractor okuyabilir | Belge seviyesi | Ana indexer akışına henüz bağlı değil |

## Belge türü kabiliyetleri

### Duruşma tutanakları
- UDF motoru `durusma_zapti` sınıflandırmasını yapabilir.
- PDF indexer isim/classification üzerinden `duruşma_tutanağı` sınıfına ayırabilir.
- PDF ise sayfa referansı, UDF ise bölüm/chunk referansı üretilebilir.
- İçerik image-only PDF/TIFF ise OCR olmadığı için okunamaz.

### Gerekçeli kararlar / kararlar
- UDF motoru `gerekceli_karar` ayırabilir.
- PDF indexer mevcut durumda genel `karar` sınıfı üretir.
- Review katmanı remote metadata + analiz türünü birlikte kullanarak `gerekçeli_karar` / `karar` ayrımını normalize etmeye çalışır.
- Ayrım yalnız metadata veya text bunu destekliyorsa yapılır.

### Dava / cevap / beyan / savunma dilekçeleri
- UDF motoru daha ayrıntılı sınıflandırır: `dava_dilekcesi`, `cevap_dilekcesi`, `beyan_dilekcesi`, `savunma` vb.
- PDF indexer genel olarak `dilekce` sınıfına düşebilir.
- Review katmanı UYAP başlığı / türü / dosya adı / analiz sınıfını birlikte normalize eder.
- Aynı isimli belgeler remote document DB ID ile ayrı kaynak olarak tutulur.

### Bilirkişi raporları
- UDF motoru `bilirkisi_raporu` ve bazı itiraz/beyan türlerini ayırabilir.
- PDF indexer isimde `bilirkisi` veya `rapor` görürse `rapor` sınıfı üretir.
- "Sonuç" bölümü yalnız UDF section extraction bunu gerçekten üretirse bölüm referansıyla sunulabilir; PDF için otomatik sonuç-bölümü ayırıcı henüz yok.

## Metadata ve bağlantı durumu

UYAP remote kayıtlarında şu bilgiler mevcut:
- BONO case ID
- `uyap_dosya_id`
- `remote_document_id`
- stable key
- remote title
- document type
- document date
- original filename
- local asset ID
- staging / filed path
- status

Local asset tarafında:
- SHA-256
- dosya adı / uzantı
- archive path / archive policy
- physical asset locations
- document analysis
- knowledge chunks

### UYAP bağlantısı
Repo'da kalıcı ve güvenilir doğrudan UYAP portal URL'si saklanmıyor. Bu nedenle review modeli sahte URL üretmez. Bunun yerine:
- `uyap_dosya_id`
- `remote_document_id`
- BONO case ID
- internal content endpoint (`/api/assets/:id/content`)
verilir.

## Mevcut analiz motorları

### PDF
`scripts/index_pdf_library.py`
- `pypdf.PdfReader`
- embedded text extraction
- page-by-page extraction
- `document_analysis`
- page metadata'lı `knowledge_chunks`
- `analysis_status=completed | no_text | failed`

### UDF
`scripts/udf_engine.py` + `scripts/index_udf_library.py`
- ZIP/UDF `content.xml`
- raw text
- paragraph structure
- headings / sections
- case number, dates, amounts, roles gibi alanlar
- template/style profile
- chunks
- `document_analysis` + `knowledge_chunks`

## Yeni bağımsız review katmanı

`bridge/case_document_review.js`
- yalnız SELECT/read işlemleri
- tek case scope
- canonical physical path seçimi
- SHA-256 verification
- extraction status ayrımı
- page / section / chunk kaynak referansları
- unreadable document listesi
- drafting corpus üretimi

`scripts/extract_review_text.py`
- PDF ve UDF için DB'ye yazmadan doğrudan extraction
- ZIP/EYP için member manifest
- image/TIFF için açık `image_requires_ocr`
- bozuk dosya için `failed`
- unsupported format için açık `unsupported`

`scripts/case_document_review_cli.js`
- SQLite DB'yi read-only açar
- tek case review JSON + drafting corpus üretir

## Açık eksikler

1. OCR yok. Taranmış PDF / TIFF / image belgeleri okunamaz.
2. UDF için gerçek sayfa numarası yok; bölüm/paragraf/chunk referansı kullanılır.
3. DOC/DOCX/RTF için text analyzer yok.
4. XLS/XLSX için hücre bazlı içerik extractor yok.
5. PDF bilirkişi raporu için otomatik "sonuç" bölüm segmentasyonu henüz yok.
6. Kalıcı UYAP portal deep-link yok; yalnız UYAP identifiers ve BONO content endpoint mevcut.
7. Yeni review katmanı henüz server/native UI route'una bağlanmadı; bağımsız ve test edilmiş modül/CLI olarak hazır.
