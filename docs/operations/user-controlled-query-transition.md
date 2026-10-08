# Kalıcı sorgu geçmişi ve kullanıcı kontrollü UYAP — teslim

## Durum

İzole geliştirme tamamlandı; canlı kurulum veya DB geçişi yapılmadı. Canlı 270 komut hâlâ önceki durumundadır. Bu teslim onları çalıştırmaya izin vermez. Dağıtım adayı yalnız `USER-CONTROLLED-QUERIES-release` paketidir; v1–v4 ara adaylardır.

## Eski 270 komutun akıbeti

Onaylı bakımda masaüstü/Core ve bütün executor'lar kapalıyken önce kaynak DB, mevcut WAL/SHM dosyalarıyla birlikte ayrı özel yedek dizinine kopyalanır. Kaynak hash'leri kopyalama öncesi/sonrası karşılaştırılır; doğrulama kopyasında SQLite integrity_check çalışır. Manifest kaynak yolu, dosya hash'leri, durum sayıları, yerel komut ID listesi ve bu listenin SHA-256 değerini tutar. Gerçek DB yedeği Git'e veya bu teslim paketine alınmaz.

Migration tam 270 queued/fetch_json/attempts=0 kaydı, boş dispatched_at/finished_at ve yedek ID digest eşleşmesi ister. Running/dispatched veya sayı farkında durur. Her komut aynı yerel ID ile geçmişe bağlanır; kuyruk satırı silinmez, archived olur; immutable retirement kaydı oluşturulur. Görünür sonuç `archived_never_executed` / “Arşivlendi · hiç yürütülmedi” olur. Başarı sayılmaz. Eski tamamlanmış satırlar da doğrulanmış yeni başarı sayılmaz; deneme kanıtı varsa legacy_attempted_unverified, yoksa never_executed görünür. Mevcut güvenli oluşturulma/sonuç zamanları korunur; aktarım zamanı ayrıca olay kaydıdır.

Tek BEGIN IMMEDIATE işlemi kullanılır. Hata veya süreç çıkışında yarım migration görünmez. Tekrar çalıştırma retirement ID'lerini, sayıyı, archived durumunu ve eski manifest digest'ini yeniden mutabıklaştırır. Arşiv satırının tekrar queued yapılması ve silinmesi DB trigger'larıyla reddedilir. Yeni claim yalnız attempts=0 + geçerli kullanıcı grant'i seçer; retirement'ları dışlar. Eski/geç sonuçlar metadata yazmadan reddedilir.

## Geçmiş ve tek dosya akışı

Geçmiş ayrı history/events tablolarındadır. Sabit izinli işlem adı, yerel case/command ID, zaman, doğrulanmış durum, sabit hata kodu ve yerel `command:N` sonuç referansı tutulur. Ham payload/yanıt, opak UYAP kimliği, kişi adı, cookie/token/header geçmişe kopyalanmaz. Eski execution queue'nun mevcut verisi yedek/arşivde korunur; bu verinin temizlendiği iddia edilmez.

Dosyayı açmak yalnız yerel destek/geçmiş okumalarını yapar. Sorgula, aynı doğrulanmış dosya bağı için son 15 dakikadaki yeni doğrulanmış başarıyı kullanır. Yeniden sorgula açıkça yeni işlem ister. UUID işlem anahtarı tekrarları, aynı dosyanın devam eden işlemi de eşzamanlı tıklamaları birleştirir. Geçerli cache yeni komut üretmez; eski legacy sonuçlar cache başarısı sayılmaz.

Yeni sorgu grant'i 10 dakika geçerlidir; dosya bağı, endpoint sözleşmesi ve payload hash'i claim/result sırasında kontrol edilir. Case kimliği veya istek değişirse gönderilmez. Claim içindeki ikinci kontrol yarışa karşı korur. Süresi geçen/running kalmış işlem belirsiz veya başarısız olur; otomatik tekrar edilmez. HTTP 200 içindeki UYAP hata yanıtı başarı değildir. Eksik/gruplu/aidiyeti belirsiz belge yanıtı içeri aktarılmaz.

Normal extension startup/activate/reload otomatik portal auth probe veya sayfa yenileme başlatmaz. Yetkili kullanıcı işlemi bekliyorsa, oturumu doğrulamak için mevcut auth probe aynı işlem için en çok bir kez istenir. Bunun dışında pasif auth kanıtı kullanılır. Yeniden başlatma grant oluşturmaz; iki sekme atomik claim'i çoğaltamaz. Eski açık content/probe guard'ı handshake vermezse poll/dispatch kapalı kalır. Chrome sayfasının yenilenmesi oturum/paneli koruma garantisi değildir ve ayrı kullanıcı işlemi gerektirir.

## Destek ve aidiyet sınırı

Bu sürüm geniş keşif, dosya arama, taraf/detay ve otomatik session discovery akışlarını açmaz. Yalnız kanıtla sertifikalanmış mahkeme dosyasında mevcut document.list sözleşmesi desteklenir. Endpoint POST/avukat.uyap.gov.tr/list_dosya_evraklar.ajx olmalıdır. Yanıt yalnız flat tumEvraklar dizisindeki her evrakın dosyaId + evrakId alanları hedef dosyayla tutarlıysa kabul edilir; farklı gerçek şema otomatik genelleştirilmez.

`certifyBinding()` yalnız yerel operatör hazırlığı içindir; HTTP/UI üzerinden sahte “doğruladım” yolu yoktur. Sertifika girdisi kendi başına portal kanıtı üretmez. Gerçek gözlem ve kullanıcı doğrulaması olmadan kullanılmamalıdır. Canlı dosyalara sertifika yazılmadı. Bu nedenle her mevcut mahkeme dosyasının hemen sorgulanabileceği iddia edilmez.

CBS case 93 / 2026/51832 hâlâ verification_required / desteklenmiyor durumundadır. 2026/51962 ve talimat grupları dahil edilmez. CBS fail-closed kapısı korunur. Önce ayrı onaylı kontrollü gözlemle kimlik/grup bağı kanıtlanmalıdır; bu teslim o gözlemi veya Efe evrak indirmesini tamamlamaz. Yeni normal paket kurulduktan sonra eski observer ZIP doğrudan uygulanamaz; preimage kontrolü bunu durdurur. Gerektiğinde gözlem paketi yeni kaynaklara göre ayrıca hazırlanıp doğrulanmalıdır.

## Sorgu ve indirme ayrılığı

manualDownloadPaused değişmeden document.list çalışabilir. 200 queued/running aktif komut sınırı her yeni grant'te transaction içinde uygulanır. PDF kuyruğu yalnız doğrulanmış belge proof'u, açık belge seçimi ve ayrı confirmed onayı ile oluşur. Bu işlem askıyı kaldırmaz. Askının kaldırılması da ayrı confirmed kullanıcı işlemidir. Normal UI'de bunlar ayrı kontrollerdir. Bu sürüm yalnız mevcut PDF referansını destekler; UDF indirmesi doğrulanmış gibi sunulmaz. Bakım onayı fiziksel indirme veya pause kaldırma onayı değildir.

## Paket ve rollback

16 payload dosyası ve mevcut 8 dosyanın birebir rollback preimage'ı manifestte listelenir. Yeni 8 dosya için beforeSha256 null'dır. Core server/uyap/worker ve canlı UI kaynaklarında yalnız benzersiz, açık anchor'lar patchlenir; bütün integration branch canlı kökün üzerine kopyalanmaz. Yeni policy/HTTP/UI modülleri ve normal extension bağımlılıkları ayrıca eklenir. Extension paket sürümü 0.4.0; Chrome permissions/host_permissions genişlemez. Manifest dosya/tool SHA-256 değerlerini, paket buildId'sini ve extension source build kimliğini içerir. Canlı preimage salt-okunur Verify sonucunda original olarak eşleşti; bakım anında yeniden kontrol zorunludur.

Paket kurucusu bilinmeyen preimage, aktif/belirsiz Node/Core/Desktop, dolu port veya aktif operasyon kilidinde durur. Kısmi kurulum hash'lerle görünür; bilinen partial durum yeniden Apply ile tamamlanabilir. Migration yalnız paketin installed hash durumu doğrulanırsa başlar. Startup bakım kilitlerini kontrol eder. Hiçbir script süreç öldürmez veya Chrome politikasını değiştirmez.

Tercih edilen DB geri dönüşü RollbackHold'dur: policy rollback_hold olur; history, retirement ve archived kayıtlar korunur. Kuyruk yeniden canlandırılmaz. Bu durumdan otomatik tekrar açılma yoktur; giderilmiş sürüm ve ayrı onay gerekir. Pre-migration DB'yi veya eski normal executor'u otomatik geri yüklemek güvenli rollback değildir. Kod rollback gerekiyorsa executor'lar kapalı kalır; eski normal Core yeniden başlatılmaz. Önceki LOCAL-RETURN-HOLD ancak onun exact preimage durumuna uygun geri dönüşte ayrıca kullanılabilir. Testte kod rollback birebir doğrulandı; bu, eski normal çalışma modunu açma onayı değildir.

## Tek toplu canlı bakım/onay listesi

1. Güncel PID/port, tanımlanamayan süreç, aktif job/command, extension ID/source ve paket preimage'larını yeniden kontrol et. Fark veya running/dispatched komut varsa dur. Kullanıcının teyit ettiği extension ID/kök geçerlidir; eski PID sabit sayılmaz.
2. Kullanıcı Chrome extension executor'larını kapatır; masaüstü tray Exit ile kontrollü kapatılır. X yalnız gizler; watchdog Core'u yeniden başlatabilir. Tray Exit çocuk süreçleri öldürebileceği için çalışan işi varken bu adım uygulanmaz. Desktop/Core/worker'ın gerçekten kapandığı doğrulanır; Chrome/UYAP sorgusu yapılmaz.
3. Özel tutarlı yedek+manifest için BackupOnly adımına izin ver; sonra paket Apply ile yeni kodu kur, installed hash doğrula. Yeni Core henüz başlamaz. Önceden observer/hold overlay uygulanmışsa aday preimage uyuşmaz; otomatik üzerine yazma yapılmaz, bilinen overlay geri dönüşü ayrıca doğrulanır.
4. query_transition.ps1 BackupMigrate ile exact270 geçişini yap; 270 archived/retirement/history eşleştirmesini, sıfır eski queued seçilebilirliğini ve manual pause korunmasını doğrula. Başarısızlıkta devam etme.
5. Doğrulanmış kökten normal Core'u kontrollü başlat; health user_controlled ve hold false olsun. Desktop başlatılmadan pending_restore.json olmadığı kontrol edilir; varsa dur. Normal başlangıç local jobs/recovery/scan/backup ve DB/arşiv yazıları yapabilir: bunlar bakım onayının açık kapsamı olmalıdır. Policy otomatik UYAP komutu üretimini engeller.
6. Yeni extension'ı açık onayla reload/enable et, ID/source + manifest/hash + probe handshake doğrula. Eski guard varsa sayfayı otomatik yenileme; panel/oturum kaybı riskini kullanıcıya bildir. İlk açılışta yeni UYAP sorgusu veya auth probe başlamamalı; yeni sorgu için ayrıca dosya içindeki açık kullanıcı işlemi gerekir.
7. Yerel geçmiş/queue mutabakatı tamamlanınca LOCAL-RETURN-HOLD'a ihtiyaç kalmaz. Gerçek portal sorgusu, dosya bağı sertifikası yazımı, case93 gözlemi, metadata aktarımı, fiziksel indirme ve pause kaldırma bu bakım izninden ayrıdır. Bunlar ayrıca açık onay gerektirir.

Kısa kullanıcı talimatı: “Chrome ve doğru UYAP panelini açık bırak. Bakım sırasında sorgula/yenile/indir düğmelerine basma. Extension reload sonrası eski probe uyarısı veya panel kaybı olursa dur; kendiliğinden yeniden sorgulama yapma. Doğru dosyayı tekrar açmak gerekiyorsa önce yeni işlem onayı ver.”

## Test kanıtı

Ayrı JSON test çıktıları teslimdedir. Sentetik DB ve yerel loopback HTTP kullanıldı; gerçek UYAP executor'u yoktu. 270 ID mutabakatı, transaction exception ve row100 sırasında abrupt process exit, idempotency, immutable arşiv, geç sonuç, stale worker, değişen dosya/payload/endpoint, kullanıcı dedupe/cache, ayrı download onayı/pause, 200 sınırı, HTTP200 yetki hatası ve gizlilik test edildi. Gerçek canlı-source overlay sentetik kurulumda normal worker açıkken yeniden başlatıldı; eski270 çalışmadı, yeni açık tek-dosya sorgusu ve cache çalıştı. Paket kesintisi/port çakışması, PowerShell wrapper'ları sentetik inventory ile, exact kod rollback ve DB hold rollback test edildi.

Eski broad-search HTTP E2E'nin beklenen davranışı artık 409/no queue'dur; parser birim regresyonları korunmuştur. Güvenlik allowlist'i gevşetilmedi. test:uyap mevcut izinli endpoint fixture'ı ve negatif yasak-endpoint kontrolüyle geçmektedir. Canlı Chrome/UYAP davranışı, gerçek mahkeme şeması varyantları ve CBS aidiyeti izole testlerle kanıtlanmış sayılmaz.
