# Archive Engine Integration Contract

Bu belge Chat-Archive (`feature/archive-engine`) ile Chat-UYAP (`feature/uyap-core`) arasındaki sorumluluk sınırını tanımlar.

## Sahiplik sınırı

Chat-UYAP şunların sahibidir:
- UYAP auth/session ve browser executor
- `dosyaId` / `evrakId` / stale-token recovery
- `document.list` ve sorgu akışları
- query/download lane
- dosya bazlı en fazla 200 evraklık download batch
- download command lifecycle

Chat-Archive şunların sahibidir:
- başarılı gerçek download sonrasında belge doğrulaması
- staging -> canonical archive
- UDF asli format koruması
- TIFF/HTML -> PDF dönüşümü
- XLS/XLSX asli kaynak koruma + opsiyonel PDF preview
- ZIP/EYP member extraction ve faydalı evrak seçimi
- SHA-256 duplicate yönetimi
- archive folder eşleştirmesi
- fiziksel/DB bütünlük auditleri

## 200 evraklık batch sözleşmesi

Archive engine yeni download komutu üretmez ve batch refill yapmaz.

Chat-UYAP bir dosya için `enqueuePendingDownloads(caseId, limit)` çağrısıyla en fazla 200 evrak kuyruğa alır. Başarılı bir download/ingest sonrası archive katmanı sadece o evrakı işler. 200 evrak tamamlandıktan sonra dosyada başka `discovered` evrak kalıyorsa yeni batch çağrısı Chat-UYAP/UI tarafından yapılmalıdır.

Archive katmanının beklediği minimum giriş:
- `caseId`
- `remoteDocumentDbId`
- doğrulanmış staging/source path
- remote metadata

Archive işleminin güvenli sırası:
1. fiziksel dosyanın varlığını doğrula
2. portal-login HTML veya bozuk payload olmadığını doğrula
3. format policy uygula
4. hedef archive folder seç
5. SHA-256 hesapla ve duplicate kontrolü yap
6. canonical fiziksel kopyayı oluştur
7. canonical kopyanın SHA-256 ve boyutunu doğrula
8. DB/filed metadata ancak bundan sonra güncellensin
9. transient staging/Downloads source cleanup en son yapılsın

## Chat-UYAP worker değişiklikleri için regresyon incelemesi

Canlı worktree farkında `bridge/worker.js` içindeki üç `uyap.enqueuePendingDownloads(x.caseId)` çağrısı ve maintenance içindeki global discovered-case auto enqueue kaldırılmıştır.

### Beklenen olumlu etkiler
- Archive post-processing download kuyruğunu sahiplenmez.
- Tek belge işlendikten sonra arka planda kontrolsüz global refill yapılmaz.
- Kullanıcının dosya bazlı batch seçimi korunur.
- `download pause` davranışı worker maintenance tarafından delinmez.

### Regresyon riskleri
1. **Batch continuation:** 200 sınırı dolduğunda 201. ve sonraki evraklar otomatik refill edilmez. UI/API açık biçimde “kalan indirilebilir evrak” sayısını göstermeli ve yeni batch başlatabilmelidir.
2. **Stale `download_queued`:** Komut iptal/failed olduğu halde remote row `download_queued` kalırsa `enqueueRemoteDocumentDownload` yeni komut üretmez. Chat-UYAP komut/status reconciliation sağlamalıdır.
3. **Yeni document.list sonuçları:** Evrak listesi yenilendiğinde yeni `discovered` belgeler otomatik indirilmez. Bu per-file modelde beklenen davranıştır ancak UI bunu görünür kılmalıdır.
4. **Container sonrası devam:** ZIP/EYP ingest artık batch refill tetiklemez. Batch başında komutların topluca kuyruklanması nedeniyle normaldir; archive code bunun devam mekanizmasına güvenmemelidir.
5. **Manual pause ayrımı:** Manual download pause ile geçici viewer/token pause ayrı state olarak korunmalıdır. Archive engine bu state’leri doğrudan değiştirmemelidir.

## Arşiv güvenlik ilkeleri

- Kaynak dosya canonical kopya doğrulanmadan silinmez.
- UDF hiçbir otomatik akışta PDF’e dönüştürülmez.
- ZIP/EYP source yalnız tüm seçilen üyeler başarıyla işlendiğinde temizlenebilir.
- Exact-hash duplicate sonucu başka case klasöründeki canonical görünürlüğü yok etmemelidir.
- Vekaletnameler gibi merkezi kaynak klasörleri normal archive-root dışı istisna olarak audit edilir.
- `Downloads` içindeki tek fiziksel kopya her zaman warning kabul edilir.
- Integrity checker varsayılan olarak salt-okumadır.

## Cross-branch fixture gate

Chat-UYAP düzeltmeleri archive branch'e merge edilmeden de test edilebilir.

Örnek:

```powershell
node scripts/archive_download_contract_gate.js --uyap-module "<uyap-worktree>\bridge\uyap.js"
```

Gate fixture DB kullanır; canlı UYAP oturumu, canlı kuyruk ve canlı veritabanı gerekmez.

Gate'in minimum kabul koşulları:
- ilk çağrı 200 uygun evrakta tam 200 queue edebilmeli
- aynı case için ikinci eşzamanlı trigger active toplamını 200'ün üzerine çıkaramamalı
- ilk batch tamamlandıktan sonra kalan evrak sonraki batch ile alınabilmeli
- failed/cancelled download command ingest tarafından reddedilmeli; staging/filed oluşmamalı
- staging -> canonical hash ve byte-size bütünlüğü korunmalı
- UDF byte bütünlüğü korunmalı
- duplicate aynı canonical target'ı yalnız doğrulanmış aynı hashte reuse etmeli

## Canonical case-scope güvenliği

Exact-hash duplicate tek başına başka dava klasöründeki fiziksel target'ı reuse etmek için yeterli değildir. Hedef path beklenen dava archive klasörü içinde olmalıdır. `archive_safety.copyVerifiedIntoCase()` bu invariantı fixture/test yardımcı katmanında uygular:
- aynı hash + doğru case target -> reuse edilebilir
- aynı hash + yanlış case target -> reddedilir
- aynı isim + farklı içerik -> overwrite edilmez
- yarım/bozuk source -> mevcut canonical target korunur
- staging'den ikinci işleme -> yeni duplicate fiziksel dosya üretilmez
