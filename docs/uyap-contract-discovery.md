# UYAP sözleşme keşfi — v1

Bu çalışma canlıya uygulanmamıştır. Kaynak: mevcut extension ve Core kodu, yerel gözlem şeması ve kullanıcı tarafından doğrulanan arayüz davranışları. Gerçek dosya kimlikleri ve belgeler bu depoya alınmaz.

## Doğrulanan akış

CBS: İl → CBS → Açık/Kapalı → liste → dosya seçimi → Evrak.
CBS taraf adı araması ve Taraflar sekmesi doğrulanmış değildir. Mevcut party-search kodu bu çalışmada yürütülmez veya kaldırılmaz.

Açık Evrak paneli ana soruşturmanın yanında başka soruşturma ve talimat grupları gösterebilir. Panel başlığı, bütün grupların belge aidiyetini kanıtlamaz. `dosyaId` opak değerdir; oturumlar veya servisler arasında değişmezliği bilinmiyor.

Hukuk/ceza sorguları, ilçe seçimi, kapalı sorgular, duruşma/takvim ve görüntüleme/indirme akışlarının tam sözleşmeleri **unknown**. Mevcut endpoint adları bu işlevlerin uçtan uca doğrulandığını göstermez. Yeni sunucu isteği için kullanıcı onayı gerekir.

## Katalog ve olay kaydı

`extension/observation_contracts.js` sürümlü katalog ve Core'un kullandığı CBS aktarım güvenlik kapısını içerir. Her kayıt kaynak, güvenilirlik, önkoşul, hata ve fixture referansı taşır. Bütün keşif sözleşmeleri `executable:false`; katalog endpoint onaylarını otomatik değiştirmez. HTTP yöntemleri yeni olaylarla doğrulanana kadar unknown kalır.

Page probe her fetch/XHR isteğine ortak olay kimliği ve başlangıç zamanı verir. Background sekme/frame kimliğini kendi sender bilgisinden ekler. Core temizlenmiş olayları `uyap_observation_events` tablosunda ayrı saklar; eski endpoint özet tablosu uyumluluk için kalır. Core olay deposu yalnız izinli istek alanlarını, grup şekillerini/sayılarını ve bilinen hata kodunu tutar. Belge içeriği, başlıkları, cookie, token ve Authorization kaydedilmez. Yeni tablo yalnız izole testte oluşturulmuştur; canlı DB migration onaysız yapılamaz.

Sekme kimliği dosya kimliği değildir. `action`, `caseBinding`, `parameterProvenance` alanları halen unknown/unverified. DOM panel başlığı ile ağ olayı arasında henüz kanıtlanmış bağlantı yoktur. Event ID korelasyon içindir; güvenlik kimlik doğrulaması değildir. Mevcut localhost ve page-message güven sınırı genişletilmez.

## CBS aktarım güvenliği

Grup yapısının gerçek tam örneği ve aidiyet sözleşmesi elde edilene kadar CBS `upsertRemoteList` yazmadan reddeder. Aynı kapı `reportResult` içinde completed yazılmadan kontrol edilir. Bu sürüm CBS aktarımını etkinleştirmez; yanlış case'e metadata yazılmasını engeller. Mahkeme akışı mevcut davranışını korur, doğrulanmış yeni adaptör olarak sunulmaz.

## Sonraki onaylı gözlem

1. İzole değişiklikler incelenir; canlı Core/extension/DB uygulaması ayrı onaylanır.
2. Kullanıcı hedef panel bağlamını doğrular. İstek başlatabilecek geçişler ayrıca onaylanır; genel CBS keşfi tekrarlanmaz.
3. Tek kontrollü evrak metadata olayı, sekme/frame/zaman ve panel bağlamıyla karşılaştırılır. Kimlik uyuşmazlığında veya yetki reddinde durulur.
4. Bu sürüm grup aidiyeti kanıtını veya tam belge metadata'sını yakalamaz. Gereken minimum kimlik ve tarih/tür alanları ancak gerçek örnek doğrulanınca eklenir; iç içe yapılar için varsayımsal parser yazılmaz.
5. Aidiyet fixture'ları ve seçili metadata aktarımı onaylandıktan sonra fiziksel indirme, hedef klasör ve pause değişikliği ayrıca onaylanır. 200 aktif komut, hash ve aynı-fd arşiv korumaları korunur.

## Test

`node scripts/test_uyap_observation_contracts.js` tamamen sentetik, geçici DB kullanır. Olayların ezilmemesi, tekrarların deduplikasyonu, sırların dışlanması, karışık CBS gruplarının yazılmaması ve HTTP 200 yetki reddinin başarı sayılmaması sınanır. Canlı UYAP testi değildir.
