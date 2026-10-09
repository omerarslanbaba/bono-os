# BONO OS — Yapay Zekâ Geliştirme Ajanları İçin Talimatlar

**Bu depoda çalışmaya başlamadan önce [VISION.md](VISION.md) dosyasını oku.** BONO bir UYAP indiricisinden fazlasıdır: Windows üzerinde yerel öncelikli, güvenilir ve zamanla daha otonom olacak bir hukuk asistanıdır.

## Öncelik ve gerçeklik denetimi

1. Kullanıcının mevcut açık isteği ile VISION.md'yi birlikte değerlendir. Vizyon, **kullanıcının somut talimatının yerine geçmez**.
2. VISION.md'deki hedefleri mevcut uygulanmış özellikler sanma. Kaynak kodu, testleri, branch/PR durumunu ve canlı ortam kanıtını ayrı doğrula.
3. Bir işe başlamadan kapsamı, beklenen sonucu, riskleri ve test planını belirle. Aynı belirsizlik hakkında sürekli rapor yazmak yerine izole ortamda çözülebilen hatayı düzelt ve yeniden test et.
4. İlgisiz özellikleri veya geniş mimari değişiklikleri sırf mümkün diye uygulama. Mevcut iş akışını ve güvenlik sınırlarını koru.

## UYAP ve dosya aidiyeti

- Yalnız kullanıcının yetkili olduğu UYAP oturumları ve izin verilen yöntemler.
- Gözlenmemiş endpoint/parametre/DOM akışı, CBS taraf sorgulaması, dosyaId dönüşümü, grup ağacı veya indirme referansı **uydurulmaz**.
- HTTP 200, UYAP uygulama hatası yok demek değildir.
- 'Dosya listelendi', 'evrak listesi alındı', 'metadata bağlandı', 'evrak indirildi' ve 'hash doğrulandı' farklı statülerdir.
- CBS / talimat / başka dosya gruplarını yanlış dosyaya bağlama. Kimlik ve grup aidiyeti belirsizse otomatik import **fail-closed**.
- İndirme pause, kuyruğun işlenmesi, sorgu yürütülmesi ve gözlem modu ayrı mekanizmalardır; birini diğerinin güvence ikamesi kabul etme.
- Portal/CDP/Chrome güvenlik ve erişim kısıtlarını aşma.

## Veri, arşiv ve gizlilik

- Kaynak DB ve gerçek dosyaları koru; değişikliklerden önce uygun yedek, bütünlük kontrolü, geri dönüş planı ve açık kapsam.
- Yüksek riskli değişikliklerde staging/atomic işlem, SHA-256 kontrolü, izinli rollback; kısmi kurulum ve restart senaryolarını test et.
- Kimlik bilgileri, oturum sırları, cookie, Authorization, tebligat içeriği, müvekkil dosyası veya gereksiz kişisel veriler telemetry/log/PR/fixture içinde tutulmaz.
- UYAP belgeleri ile 'Sizin Ekledikleriniz' kullanıcı dosyaları birbirinden ayrı kaynak etiketi taşır.
- Tek kanonik evrak ve Windows masaüstünde kolay erişim görünümünü hedefle; veri kopyalarının çakışmasına yol açma.
- Bulut ve üçüncü taraf AI/MCP bağlantıları için ayrı veri erişim/yetki sınırları koy.

## Otomasyon ve kritik işlemler

- Kullanıcı tanımlı kapsamda doğrulanmış rutin sorgulama, güvenli metadata toplama, indirme/arşivleme ve bildirim otomasyonunu hedefle.
- **Dilekçe gönderimi, başvuru, ödeme, feragat vb. dış etkili hukuki işlemleri açık, özgül kullanıcı onayı olmadan yürütme.**
- Başlangıçta belge metninden kapsamlı otonom hukuki yorumlama vaat etme.
- Süre motorunda kanuni son günü usule uygun hesapla; **−1 takvim günü yalnız iç hedef** olarak saklanır. İki tarih ayrı gösterilir; belirsiz tebligat tarihini veya süreyi model tahminiyle kesinleştirme.
- UETS, barkod, offline bulut izlemesi, mobil uyarılar, dilekçe hafızası ve ileri seviye AI analizi geleceğin hedefleridir; bugün varmış gibi API ve veri modeli varsayma.

## Geliştirme ve dağıtım disiplini

- Çalışan Core, extension, WebView2, Archive ve masaüstü sistemini bozma; ilgili regresyonları çalıştır.
- İzole dalda test/commit/PR işlemleri ile canlı sistemdeki process, DB, Chrome, UYAP sorgusu, indirme ve migration işlemlerini ayır. **Canlı ve dış etkili işlemler için kullanıcının verdiği izin sınırına uy.**
- Prod kurulumunu test başarısıyla eşitleme. GO-READY = izole hazırlık; live GO = canlı önkoşullar ve açık onay.
- Sorgu geçmişi ile yürütme kuyruğu ayrıdır; hiç çalışmamış komutu 'başarılı sorgulandı' yazma. Eski queued komutları izinsiz yeniden yürütme/silme.
- İki bağımsız avukat kurulumu için kullanıcıya özel yollar, ayrı DB/arşiv/ayarlar düşün; sabit kullanıcı profili yolu hardcode etme.
- Hata durumunu gizleme, teste göre gerçek güvenlik kontrolünü gevşetme, sentetik sonuçları canlı kanıt gibi sunma.
- Her teslimde: değişen dosyalar, test/kanıt, mevcut sınırlamalar, rollback etkileri ve gerçekten kullanıcı onayı gerektiren işlemler.

## Ajanın işe başlama kontrolü

1. VISION.md ve ilgili repo belgelerini oku.
2. Mevcut branch/PR/çalışma ağacı ile hedef çalışan sürümü ayır.
3. İstenen özelliğin mevcut kodda ne kadarının gerçekten bulunduğunu belirle.
4. İzole ortamda en küçük güvenli uygulamayı yap; test ve regresyonu çalıştır.
5. Bilinmeyen UYAP sözleşmeleri için `unknown/unverified` işareti ve dar gözlem planı bırak.
6. Canlı işlem gerekiyorsa tek, anlaşılır, bağımlılık sıralı onay listesi sun.

**Temel ölçüt:** BONO, avukatın işini bağımsızlaştırır ve hızlandırır; fakat yanlış dosyaya belge bağlayarak, doğrulanmamış son gün üreterek veya sessizce yetki sınırını aşarak bunu yapmaz.

## Otonom geliştirme ve teslimat protokolü

- **Her görev tek gözlemlenebilir kullanıcı sonucuna odaklanır.** Geniş istekleri bağımsız, küçük ve test edilebilir teslimatlara böl; görevi sürekli genişletme.
- Başlamadan önce **hedef davranış**, **sahip olunan modül**, **kabul kriterleri**, **hedefli testler** ve **kapsam dışı işler** netleştirilir. Belirsizliği güvenli varsayımla izole çözebiliyorsan kullanıcıyı meşgul etme.
- Ajan kendi dalında kodlama, izole test, hata düzeltme, commit ve draft PR için tekrar izin istemez. Canlı Core/DB/Chrome/UYAP, gerçek dosya taşıma/indirme, sorgu gönderimi, hukuki dış işlemler veya yetki sınırının değişmesi **ayrıca açık kapsamlı izin** gerektirir.
- Kabul kriterleri ve ilgili regresyon testleri geçince **teslim et ve dur**. İlgisiz hata/önerileri `BACKLOG.md` için kısa not olarak hazırla; backlog yazarken başka ajanın eşzamanlı değişikliğini ezme. Sırf ek inceleme için görevi bitirmeyi geciktirme.
- Sürekli onay/NO-GO raporu döngüsü kurma: kendi yetkin içindeki engeli gider, yeniden test et. Kullanıcıya yalnız gerçek yetki sınırı, veri kaybı/hukuki risk veya dış bağımlılığın giderilememesi durumunda başvur.
- Kod sahipliğini ve aktif dal/PR'ları kontrol et. Başka ekibin dosyası gerekiyorsa sözleşme/fixture hazırla; sessizce üzerine yazma. Entegrasyonu sorumlu dal/ajan yapsın.
- **Kısa teslim formatı:** (1) değişen dosya/özellik; (2) kullanıcının artık yapabildiği iş; (3) testler ve sonucunun kanıtı; (4) commit/PR; (5) varsa tek gerçek canlı doğrulama engeli. Başka görev başlatmadan dur.
- Vizyon, yapılan iş ve canlı doğrulanmış davranışı farklı statüler olarak bildir. Görev kapanışı tamamlanmamış başka geliştirmeleri olmuş gibi göstermez.

## Bağlantılı dosyalar ve evrakların tekil arşivi (2026-10-09 kararı)

- **Bir hukuki süreç birden çok UYAP dosyasına yayılabilir.** Eski/yeni CBS soruşturmaları, talimatlar, ilk derece ve istinaf/temyiz dosyaları kendi birim, yıl/numara ve opaque `dosyaId` kimliklerini korur. Ayrı numaralı diye ilgili dalları gizleme; aynı panelde göründüler diye kesin ilişki varsayma.
- **Kaynak aidiyeti ile görünüm ilişkisini ayrı tut.** Belgede özgün kaynak birim, `dosyaId`, `evrakId` ve varsa doğrulanmış içerik hash'i korunur. İlgili dosya ekranında başka kaynaktaki evrakı göstermek kaynak dosya kimliğini değiştirmez. Dosya ilişkisini tür, kanıt ve doğrulama durumu ile ayrıca kaydet. PR #17 kimlik/aidiyet fail-closed kapısını geçersiz kılma.
- **Kapsamlı ama kullanıcı kontrollü indirme.** Kullanıcı açıkça “Evrakları İndir” dediğinde hedef dosyanın ve doğrulanmış ilişkili grupların eksik, indirilebilir evraklarını varsayılan olarak seç. Dosya açmak, aramak veya önbellek göstermek kendiliğinden indirme başlatmaz; indirme pause ve izin kapıları aynen korunur.
- **Belirsiz bağlantıda seçimi sor.** Birden fazla eski CBS, talimat ya da istinaf grubu belirdiğinde kaynak birim/numara, ilişki türü, kanıt düzeyi, evrak sayısı ve indirme durumu ile seçenekleri göster. Kullanıcının seçim yapması eksik kaynak aidiyetini doğrulanmış kılmaz; yanlış `dosyaId` altında metadata/evrak kaydetme.
- **Mükerrer fiziksel içerik oluşturma.** Güvenilir kaynak kimliği ve bütünlüğü doğrulanmış SHA-256 ile önceki fiziksel arşivi yeniden kullan. Aynı hash farklı kaynaklardan gelen hukuki evrak kayıtlarının metadata/provenance ayrımını ortadan kaldırmaz ve tek başına dosya ilişkisi kanıtlamaz.
- **Yaşam döngüsünde belgeleri bağla, tekrar indirme.** CBS'den kovuşturmaya ya da ilk dereceden istinafa geçişte doğrulanmış ilişkiler üzerinden mevcut evrakları göster; eski dosya kimliğini ve tarihçeyi koru.
- **Aşamaları karıştırma.** `case search → document.list → grup/çocuk aidiyet doğrulaması → izinli indirme → bütünlük kontrolü` ayrı başarıları ifade eder. HTTP 200 ve CBS dosyasının bulunması evrak listesi veya indirme başarısı değildir.
- **Bekleyen sorguyu teşhis et.** Kullanıcı yeniden sorguladığında komut kuyrukta kalırsa grant, worker, Bridge, oturum ve kuyruk durumlarını kanıta dayalı incele. Eski komutu otomatik tekrar yürütme, yeni yetki uydurma, belirsiz durumu “çalışıyor” gösterme.
- **Arayüz sade, kanıt görünür olsun.** Ana ekranda dosya, taraflar, son sorgu, evraklar ve yapılabilir işlemler gösterilsin. Uzun teknik geçmiş ve hash ayrıntıları isteğe bağlı olsun; başarısızlık ve eksik kanıt nedenleri gizlenmesin.
- **Yetki ve gerçeklik ayrımı değişmez.** Bu vizyon kararı mevcut canlı sorgu/indirme yetkilerini genişletmez. Doğrulanmamış CBS grup-çocuk şemasını uydurma; izole testleri canlı kabul olarak sunma; diğer ajanların eşzamanlı Core/Bridge/UI çalışmalarını ezme.
