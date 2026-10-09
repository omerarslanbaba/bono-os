# Kuyruksuz açık kullanıcı oturum kontrolü

Kök neden: normal sorgu auth probe'u bekleyen kullanıcı komutuna bağlıydı; Core'daki eski login_required durumunu kaldırmak için bu komutun varlığı gerekiyordu. Önce oturumu doğrulayıp sonra sorgu oluşturma koşulu bu akışla sağlanamıyordu. Kullanıcının tekrar giriş yapması tek başına Core kaydını düzeltmiyordu.

Dosya detayındaki **Bağlantı ve oturumu doğrula** ayrı kullanıcı işlemidir. Kendiliğinden, açılışta, sekme etkinleşince veya dosya sorgu düğmesi tarafından tetiklenmez. Yalnız açık kullanıcı isteğiyle daha önce kullanılan POST `/get_avukat_id.ajx` oturum kontrolünü bir kez çalıştırır. **Bu da gerçek ortamda UYAP isteğidir ve ayrıca onay gerektirir.** Bu geliştirme sırasında yalnız sentetik yanıt kullanıldı.

Core'daki ayrı kontrol nesnesi bellekte 30 saniye yaşar. Kuyruk, grant, query history veya event satırı oluşturmaz. Açık kullanıcı anahtarı zorunludur; çift tıklama aynı işlemi döndürür. Normal user_controlled/browser_readonly modu ve boş aktif sorgu kuyruğu gerekir. Bakım kilidinde çalışmaz.

Bridge kontrolü atomik olarak bir kez sahiplenir; tab, ana frame, content document UUID ve build bağlanır. Content/probe hazır değilse portal isteği yapılmaz. Başka sekme/sayfa/build, eski veya geç gelen yanıt kabul edilmez. MV3 yeniden başlamasında kontrol tekrar gönderilmez; Core yeniden başlamasında yetki kaybolur. Gönderim/teslim sonucu belirsizse süre sonunda başarısız görünür; portal isteği otomatik tekrarlanmaz.

Yalnız HTTP 200, boş olmayan uygun JSON ve mevcut uygulama-hatası denetiminin başarılı olması kabul edilir. HTML, null/boş sonuç, 401/403 ve HTTP200 uygulama reddi başarı sayılmaz. JSON kimlik değerleri veya yanıt gövdesi iletilmez/saklanmaz; yalnız işlem/sayfa bağlamı, HTTP durumu ve sabit doğrulama bayrakları taşınır. Gerçek auth yanıtı bu sınırlar içinde doğrulanamazsa sonuç unknown/blocked kalır; yeni alan anlamı tahmin edilmez.

Başarılı eşleşme Core'un oturum durumunu ready yapar; yalnız uyap_login_required rate etiketi kaldırılır. Diğer rate limit/backoff değerleri korunur. Queue, geçmiş, download pause, discovery, session recovery jobs veya belge indirme tetiklenmez. Bu kontrol dosya kimliği, dosyaya erişim yetkisi veya CBS evrak aidiyeti kanıtı değildir. Önceki sorgu/grant güvenlik kontrolleri korunur.

HTTP: `/api/uyap/session-check/start` mevcut aynı-origin açık kullanıcı eylemi kontrolünü kullanır. `/claim` ve `/result` ayrı Bridge başlığı ve varsa extension origin ister; genel web origin kabul edilmez. CORS allowlist genişletilmez. İlerleme mevcut salt-okunur `/api/uyap/user-query-state` yanıtındaki `sessionCheck` alanından okunur. Core kodu ve extension birlikte güncellenmelidir; eski content/probe varsa işlem sessizce başarılı sayılmaz, zaman aşımına gider.

Testler: 15 modül senaryosu; gerçek Core HTTP + gerçek background/content/page_probe kaynaklarıyla sentetik Chrome/UYAP uçtan uca test; kullanıcı düğmesi UI testi. Başlangıçta sıfır otomatik auth, bir açık oturum kontrolünde tam bir auth isteği, sıfır dosya sorgusu, queue/history/events/grants birebir aynı, pause korunmuş. Mevcut CBS aidiyet ve observer regresyonları ayrıca çalıştırılır.

Canlıya uygulanmadı. Sonraki ayrı onay: doğrulanmış preimage/yedekle dar Core/Bridge/UI paketi kurulur; Chrome yüklenen build doğrulanır; yalnız bu oturum kontrolü bir kez yapılır. Ready olursa case93 için önceden tanımlanan tek sorgu kabulüne geçilebilir; aksi halde komut oluşturmadan durulur. Metadata importu, indirme, pause kaldırma ve eski #17614/#17615 replay kapsam dışıdır. Rollback yalnız paket kodlarını geri döndürür; DB restore veya sorgu replay yapmaz.
