# Tek dosya UYAP evrak entegrasyonu — durum ve sözleşme

## Amaç

Bir BONO OS dosyasının UYAP evrak listesini güvenli biçimde sorgulamak, sorgu yaşam döngüsünü gerçek komut sonucuna göre göstermek ve indirmeyi ayrı kullanıcı onayına bağlı tutmak.

## Mevcut işlemler

| İşlem | Durum | Not |
|---|---|---|
| `GET /api/uyap/cases` | Çalışıyor | BONO DB'de keşfedilmiş UYAP dosyalarını ve ilişkili yerel/legacy dosyaları listeler. UYAP'a yeni sorgu atmaz. |
| Yargı türü / birim / mahkeme / yıl / esas filtreleri | Kısmi | Aktif web formu yalnız `/api/uyap/cases` sonucunu yerelde filtreler. Hedefli UYAP sorgusu değildir. |
| Global discovery | Çalışıyor | `case.units/case.search/CBS` ile keşif yapar. PDF/UDF indirme başlatmaz. |
| `POST /api/uyap/cases/:id/sync-documents` | Çalışıyor | Yalnız ilgili case için bir `document.list` komutu kuyruğa alır. Aynı case'in queued/running komutunu exact JSON caseId ile reuse eder. |
| `GET /api/uyap/cases/:id/document-sync-status` | Çalışıyor | `not_synced/queued/running/completed/empty/failed/login_required/metadata_unbound` durumlarını verir. |
| `GET /api/uyap/cases/:id/remote-documents` | Çalışıyor | UYAP metadata'sı DB'ye gerçekten işlendiğinde listeyi döndürür. |
| `GET /api/uyap/cases/:id/download-summary` | Çalışıyor | toplam/mevcut/eksik/aktif kapasite/manual pause bilgisini verir. |
| `POST /api/uyap/cases/:id/download-missing` | Çalışıyor | `confirmed:true` zorunlu. Manual pause'u kaldırmaz. Case başına queued/running toplam max 200. |
| Tek evrak download | Çalışıyor | Explicit confirm gerekir; exact remoteDocumentDbId duplicate kontrolü vardır. |
| Download ingest | Çalışıyor | Yalnız `completed download_document` komutu ingest olabilir. Failed/cancelled staging/filed olamaz. |
| Archive canonical filing | Çalışıyor | Worker case-scoped archive guard kullanır; aynı hash başka case canonical yoluna bağlanmaz. |

## Tek dosya document.list yaşam döngüsü

UI bir komutun yalnız kuyruğa alınmasını başarı saymaz.

- `not_synced`: bu case için hiç document.list terminal sonucu yok.
- `queued`: exact caseId'li document.list kuyrukta.
- `running`: extension tarafından gerçek UYAP isteği yürütülüyor.
- `completed`: response payload var ve evrak metadata'sı `uyap_remote_documents` tablosuna bağlandı.
- `empty`: UYAP başarılı şekilde boş evrak listesi döndürdü.
- `metadata_unbound`: UYAP payload'ında evrak var ama DB'ye bağlanan remote row yok; başarı gibi gizlenmez.
- `failed`: terminal komut hatası veya sonuç payload'ı yok.
- `login_required`: session kapalı veya auth kaynaklı terminal/queued durum.

UI queued/running sırasında otomatik kısa aralıklarla status'u tekrar okur ve yalnız terminal durum oluştuğunda nihai mesaj gösterir.

## Boş evrak listesini ayırma

Boş ekran tek bir "Evrak yok" durumuna indirgenmez:

1. Sorgu hiç yapılmamış → `not_synced`
2. Kuyrukta → `queued`
3. Gerçek UYAP isteği çalışıyor → `running`
4. Oturum yok → `login_required`
5. Sorgu başarısız → `failed`
6. UYAP gerçekten boş liste döndürdü → `empty`
7. Payload geldi ancak metadata bağlanmadı → `metadata_unbound`
8. Metadata var, fiziksel dosya yok → remote document satırları `discovered/download_queued/...` durumlarıyla listelenir.

## İndirme güvenliği

- `document.list` hiçbir PDF/UDF kuyruğu oluşturmaz.
- Global discovery PDF/UDF kuyruğu oluşturmaz.
- `manualDownloadPaused` document sync veya batch queue ile kendiliğinden kalkmaz.
- Download resume ayrı ve explicit user confirmation ister.
- Case başına active queued/running toplam 200 Core seviyesinde korunur.
- Failed/cancelled download command ingest edilemez.
- Same-case duplicate document.list exact JSON `context.caseId` ile bastırılır; case 1 / case 10 prefix çakışması yoktur.

## Archive guard

Chat-Archive'ın `archive_safety.js` ve `archive_case_guard.js` modülleri worker hattına bağlandı.

Gerçek akış:
`completed download_document → ingest_uyap_download → staging → archiveWithFormatPolicy → archiveOneFile/copyIntoArchiveDir → case guard → verified canonical`

Kurallar:
- Aynı SHA başka davanın canonical klasöründeyse reuse edilmez.
- Mevcut case'in canonical klasöründe aynı SHA varsa idempotent reuse edilir.
- Aynı isim/farklı içerik overwrite edilmez; suffix target seçilir.
- Kaynak verification tamamlanmadan silinmez.
- Bir SHA tek logical `local_assets` kaydı olabilir; her case kendi canonical `asset_locations` yoluna sahip olabilir.

## Hedefli UYAP dosya sorgusu — açık eksik

Aktif web formundaki Yargı Türü / Yargı Birimi / Mahkeme / Yıl / Dosya No alanları bugün yalnız BONO'ya önceden alınmış case listesini filtreler.

Canlı read-only endpoint kayıtlarında:
- `case.search` → `/search_phrase_detayli.ajx`
- `case.units` → `/yargiBirimleriSorgula_brd.ajx`
- CBS search → `/avukat_dosya_sorgula_cbs_brd.ajx`

Ayrıca gözlenmiş `/avukat_mahkemeleri_sorgula.ajx` isteği `yargiTuru/yargiBirimi/dosyaKapaliMi` gövdesi kullanıyor; bu farklı bir akıştır.

Yıl/esas/mahkeme bazında yeni UYAP isteği, gerçek `/search_phrase_detayli.ajx` request schema'sı gözlemlenmeden tahmin edilerek eklenmemelidir. Bu madde ayrı UYAP observation görevi olarak ele alınmalıdır.

## İzole testler

- `npm run test:uyap-single-case-sync`
- `npm run test:uyap-batch-safety`
- `npm run test:uyap-webview-safety`
- `npm run test:archive-worker-case-guard`
- `node scripts/test_uyap_lane_independence.js`
- `node scripts/test_uyap_extension_039_safety.js`

Chat-Archive branch selftests ayrıca bağımsız olarak çalıştırılmıştır:
- `archive_case_guard_selftest.js`
- `archive_final_safety_selftest.js`
- `archive_download_integration_selftest.js --uyap-module <feature/uyap-core bridge/uyap.js>`

## Canlı sisteme etkisi

Bu geliştirme ve testlerde canlı:
- Chrome extension değiştirilmedi,
- BONO Core restart edilmedi,
- queue değiştirilmedi,
- DB yazılmadı,
- UYAP oturumu değiştirilmedi,
- EXE değiştirilmedi.
