# BONO OS — Vizyon ve Ürün İlkeleri

> **Ürün vizyonu:** Avukatın kişisel, UYAP ile bütünleşik, proaktif ve giderek daha otonom hâle gelen masaüstü hukuk asistanı. Kullanıcının benzetmesiyle: *avukat Tony Stark ise BONO onun JARVIS'idir.*
>
> **Belge türü:** Uzun vadeli ürün vizyonu ve öncelik çerçevesi. **Bu belgedeki hedefler mevcut çalışan özellikler olarak yorumlanamaz.**
>
> **Durum:** 2026-10-09 itibarıyla ürün yönü. Gerçek kod/kurulum/endpoint durumu ayrıca doğrulanır.

## 1. Neden BONO?

BONO'nun amacı yalnızca UYAP'tan evrak indirmek değildir. Hukuk bürosunun dosya hafızasını, evrak erişimini, değişiklik takibini, süre yönetimini ve günlük iş akışlarını tek bir güvenilir ortamda buluşturmak; avukatın tekrar eden operasyonel yükünü azaltmaktır.

Uzun vadede BONO, rutin ve yetkilendirilmiş işlemleri bağımsızca yürütebilen bir hukuk asistanına evrilir. Hukuki sonuç doğuran dış işlemler — örneğin dilekçe gönderimi, başvuru, feragat, ödeme veya icra işlemi — **açık ve işlem bazlı avukat onayı** gerektirir. Bu işlemlerin çoğu şu anda ürün kapsamında değildir.

## 2. Değişmez ürün ilkeleri

1. **Veri kaybetme, yanlış kesinlik üretme.** Kısmi dosya, başarısız sorgu, indirilmemiş evrak ve doğrulanmamış UYAP bağı açık durumlar olarak saklanır. 'Bilinmiyor' hiçbir zaman 'yok' anlamına gelmez.
2. **Kaynak ve aidiyet ayrımı.** UYAP evrakı, manuel eklenen belge, kullanıcı taslağı ve harici kaynak farklı köken etiketleri taşır. Aynı panelde görünen başka soruşturma/talimat evrakı otomatik olarak hedef dosyaya bağlanmaz.
3. **Dosya varlığı ≠ evrak listesi ≠ fiziksel indirme.** Bunlar ayrı durumlar ve ayrı başarı kanıtlarıdır. Bir indirme ancak gerçek dosya varlığı, bütünlük/hash ve doğru dosya bağı doğrulandığında başarılı sayılır.
4. **Yerel-öncelikli erişim.** İlk hedef Windows masaüstünde güvenilir, çevrimdışı erişilebilir belge arşividir. Bulut senkronizasyonu/yedekleme sonraki evredir.
5. **Kullanıcı zamanını koruma.** Tekrarlı gereksiz sorgu, gereksiz kopya ve önemsiz bildirim üretme; ilerlemeyi dosya bazında göster.
6. **Doğrulanmış sözleşmeler.** UYAP endpointlerini, DOM seçicilerini, parametre anlamlarını, yetkiyi veya belge aidiyetini tahmin etme. Önce gerçek yetkili gözlem ve test.
7. **Güvenli otomasyon.** Arka planda sorgulama/indirme ancak kullanıcının belirlediği kapsam ve yetki altında, hız/sıklık kontrolleriyle ve oturum/erişim kurallarına uyarak çalışır.
8. **Gizlilik ve geri alınabilirlik.** Meslek sırrı, kişisel veriler, kimlik bilgileri ve belge içerikleri için veri minimizasyonu; izinli erişim, güvenli yedek ve geri dönüş. ChatGPT/MCP'ye otomatik toplu veri aktarımı yok.
9. **Taşınabilirlik.** Tek bir bilgisayara veya kullanıcı adına sabit yollarla bağımlı olma; ileride farklı, birbirinden bağımsız avukat kurulumlarına uygun tasarla.
10. **Vizyon/gerçeklik ayrımı.** 'Planlanan', 'prototip', 'izole test edilmiş' ve 'canlı doğrulanmış' ayrı statülerdir.

## 3. İlk kullanılabilir ürün — öncelikli kullanıcı deneyimi

### 3.1 Tek dosya üzerinden UYAP sorgusu

Avukat herhangi bir kayıtlı dosyayı açıp **UYAP'ta Sorgula** dediğinde, desteklenen ve doğrulanmış sorgu akışı yalnız o dosya için çalışır. Sonucu ve en son ne zaman başarılı sorgulandığını görür. 'Yeni Evrakları Kontrol Et' ayrı bir işlem olabilir. İlk adımda otomatik geniş keşif veya belirsiz CBS endpointleri gerçekmiş gibi çalıştırılmaz.

### 3.2 Tamamlanma ve eksiklik takibi

Dosya başına en az şu kavramlar ayrı izlenir:

- UYAP dosyasının keşfi ve doğrulanmış kimliği;
- dosya ve evrak grubu aidiyeti;
- evrak liste sorgusu (hiç / başarısız / kısmi / başarılı; zaman ve sayfalama kapsamı);
- bilinen evrak metadata'sı ve belge türü/tarihi;
- indirme (bekliyor / kısmi / mevcut);
- yerel dosya doğrulaması (hash, okunabilirlik, doğru dosya ile ilişki);
- son kontrol ve yeni evrak bulunma durumu.

Evrak listesi güncel olduğu doğrulanmadan 'dosya tamamen güncel' denmez. UYAP'ta henüz keşfedilmemiş dosyalar toplam kapsamı bilinmeyen gruptur; sıfır diye sayılmaz.

CBS, hukuk, ceza, icra ve UYAP dışı (ör. sigorta tahkim) dosyalar destek kapsamına göre farklı davranabilir. Desteklenmeyen yol açıkça işaretlenir.

### 3.3 Sorgu hafızası ve çalışma kuyruğu

Sorgunun **tarihçesi** ile henüz **yürütülmeyi bekleyen kuyruk** ayrıdır.

- Daha önce gerçekten çalıştırılmış sorgu ile yalnız oluşturulup hiç yürütülmemiş komut farklı gösterilir.
- İşlemin hedefi, zamanı, durum ve güvenli özetinin denetlenebilir kaydı tutulur. Sırlar ve gereksiz ham yanıtlar saklanmaz.
- Teknik loglar sınırsız büyütülmez; özetleme/saklama süresi politikası oluşturulur. Kalıcı dosya/evrak kimliği, aidiyet ve bütünlük kaydı bu temizlikten etkilenmez.
- Önceden sorgulandı diye yeni sorgu sonsuza kadar engellenmez: kullanıcı yenileyebilir ve periyodik güncelleme yapılabilir.
- Eski toplu keşif komutları normal açılışta kontrolsüz çalıştırılmaz; migrasyon/iptal/arşivleme ancak doğrulanmış işlem ve onayla olur.
- Sorgu çalıştırma ile fiziksel evrak indirme ayrı yetki ve kontrol alanlarıdır.

### 3.4 Windows masaüstü evrak arşivi

Masaüstünde tek tıkla erişilen bir **BONO** klasörü/görünümü hedeflenir. İki ana bölüm:

```text
BONO/
├── Müvekkiller/
│   ├── Vekâletnameler.xlsx
│   └── Vekâletnameler (PDF)/
└── Mahkemeler/
    ├── Asliye Hukuk Mahkemeleri/
    ├── Aile Mahkemeleri/
    ├── Asliye Ceza Mahkemeleri/
    ├── Cumhuriyet Başsavcılıkları/
    ├── İcra Daireleri/
    ├── Sigorta Tahkim/
    └── … diğer yargı birimleri / UYAP dışı dosya grupları
```

'**Mahkemeler**' kullanıcıya dönük üst klasör adıdır; CBS, icra ve sigorta tahkim gibi mahkeme dışı dosya gruplarını da kapsar. Her kategori altında dosya klasörünün hedef adlandırması:

`<föy no> - <müvekkil adı> - <dava/iş türü> - <mahkeme/birim adı ve numarası> - <esas/soruşturma no>`

Eksik alanlar uydurulmaz; Windows için yasak karakterler güvenle normalize edilir; olası ad çakışmaları sabit dosya kimliğiyle çözülür. Klasör adı veri tabanındaki tek kimlik kaynağı değildir.

Dosya içindeki evraklar kolayca açılabilir ve başka iş akışlarına kullanıcı tarafından aktarılabilir. **Tek kanonik içerik + güvenli masaüstü erişim görünümü** hedeflenir; aynı evrakın kontrolsüz kopyaları üretilmez.

UYAP kaynaklı belgeler ile kullanıcının isteğe bağlı eklediği belgeler ayrı görünür. Manuel ekler uygulamada **'Sizin Ekledikleriniz'** başlığıyla listelenir; otomatik olarak bütün kişisel/WhatsApp dosyaları içeri alınmaz. UYAP dışı sigorta tahkim gibi işler manuel evrakla yönetilebilir.

### 3.5 Bildirim ve periyodik takip

Avukatın belirlediği kapsam için, sistem açık ve uygunken belirli aralıklarla yeni dosya gelişmesi/evrak olup olmadığını kontrol etme hedeflenir. Her dosyayı her saat koşulsuz sorgulamak hedef değildir; sorgu sıklığı, kullanım yetkisi, hız sınırları, tekrar önleme ve dosya önceliği gözetilir.

Yeni veya önemli evrak için:

- Windows'un sağ alt bildirim alanında uyarı;
- BONO ana ekranındaki bildirim merkezi;
- doğru dosyaya ve ilgili evraka doğrudan geçiş;
- bildirim önemi/dedup, okunma durumu ve geçmiş.

İlk aşamada 'gerekçeli karar geldi', 'yeni evrak geldi' gibi güvenli metadata-temelli açıklamalar yeterlidir. Yapay zekânın serbest metinle kapsamlı hukuki belge değerlendirmesi ilk sürümün koşulu değildir.

### 3.6 Süre hesabı ve **−1 gün iç hedef kuralı**

Özellikle icra takiplerinde sürelerin izlenmesi önceliklidir. BONO, **doğrulanmış tarih ve uygulanabilir hukuk kuralından** hesaplanan **gerçek yasal son günü** ayrı tutar. Ardından kullanıcıya yönelik **iç tamamlama hedefini gerçek son günden bir takvim günü önce** belirler. Örnek: doğru hesaplanan iki haftalık süre için hukuki son gün 14. gün ise iç hedef 13. gündür.

**−1 gün kuralı kanuni süreyi kısaltmaz veya değiştirmez.** E-tebligatta ulaşma, kanunen tebliğ sayılma, süre başlangıcı, resmî tatil/hafta sonu ve özel usul kuralları somut olaya göre önce doğru hesaplanır; 'her elektronik tebligata otomatik +5 gün' gibi kestirme uygulanmaz. Kanuni süre ile iç hedef her zaman ayrı gösterilir. Kaynak/tarih/tür belirsizse kesin tarih uydurulmaz; avukat teyidi istenir. Olası deadline önce öneri olarak gösterilir; kritik takvim/süre onayı avukattadır.

Süre hesaplaması serbest üretken model tahminine değil, denetlenebilir ve test edilen kurallara dayanmalıdır.

## 4. Yol haritası — hedef, mevcut durum iddiası değil

### Evre 1 — Çalışan, güvenli masaüstü temel
Core + Chrome extension + WebView2 + Archive entegrasyonu; tek dosya sorgusu; sorgu geçmişi/kuyruk ayrımı; güvenli manuel çalışma; CBS grup aidiyeti doğrulaması; ilgili testler ve geri dönüş.

### Evre 2 — Kapsayıcı evrak envanteri ve masaüstü erişimi
CBS/hukuk/ceza/icra dosyalarının eksik evraklarının tamamlanması; doğrulanmış metadata/indirme; hash kontrollü yerel arşiv; Müvekkiller/Mahkemeler görünümü; manuel ekler; UYAP dışı dosya yönetimi.

### Evre 3 — Proaktif takip ve bildirim
Kullanıcı tarafından yetkilendirilen periyodik değişiklik kontrolü; yeni evrak bildirimleri, önem sınıflandırması; dosya bazlı inceleme görevleri.

### Evre 4 — Güvenilir süre motoru
Tebligat ve özellikle icra işlemleri için hukuki son gün + −1 gün iç hedef; açıklanabilir hesap, doğrulama, takvim ve bildirim.

### Evre 5 — Gelişmiş entegrasyon ve taşınabilirlik
UETS, barkod sorgulama, daha kolay ikinci bağımsız Windows kurulumu; sonra yerel-bulut senkronizasyonu, şifreli yedekleme, bilgisayar kapalıyken yetkili bulut izleme ve telefona bildirim. Bu özelliklerin sırası kullanım ihtiyacına göre değişebilir; ilk kullanılabilir sürümün önkoşulu değildir.

### Evre 6 — JARVIS düzeyi hukuk asistanlığı
Kullanıcı yetkisine bağlı ChatGPT/MCP/De Jure iş akışları; örnek dilekçe hafızası, güvenilir belge içerik analizi ve taslak üretimi. Mahkemeye/UYAP'a hukuki belge gönderimi gibi dış etkili adımlar açık avukat onayı gerektirir. Belge içeriği analizine güven düzeyi oluşmadan bu özellik otomatik yetkilendirilmez.

## 5. Farklı avukatlara kurulabilir tasarım

İlk hedef kullanıcının kendi Windows sistemi. Daha sonra bağımsız iş yapısı olan başka bir avukatın (örneğin Kübra Top) bilgisayarına da kurulabilmelidir. Bu nedenle dosya yolları, şifreleme anahtarları, kullanıcı bilgileri, dosya indeksleri ve ayarlar kurulum başına ayrılmalı; istemeden farklı avukatların dosyaları birleşmemelidir. Şu aşamada çok kiracılı SaaS kurmak hedef değildir.

## 6. Ürün başarı ölçütleri

- 'Hangi dosyamın hangi evrağı eksik?' sorusu birkaç tıkla yanıtlanır.
- 'Bu dosyayı UYAP'ta sorgula' eylemi, doğrulanmış akışta yalnız hedef dosyayı sorgular.
- Yeni evrak bulunduğunda kopyalanmadan, dosya bağlantısıyla bulunabilir ve gerekiyorsa bildirilir.
- Belgeler Windows klasöründen açılabilir; BONO'daki dosya ve kaynağıyla eşleşir.
- Önceki başarısız/kısmi sorgular bir sonraki adımın doğru belirlenmesine yardımcı olur; yanlış 'tamamlandı' üretmez.
- Hukuki son gün ve −1 gün iç hedef, doğrulanmış girdilerle birbirinden ayrı ve açıklanabilir gösterilir.
- Yeni sürüm/ikinci kullanıcı kurulumu mevcut verileri koruyacak şekilde geri alınabilir.

## 7. Bu belgenin kullanımı

Bir geliştirme görevi geldiğinde önce **bu vizyona katkısını** belirle; ardından mevcut kod, gerçek portal gözlemi, güvenlik sınırlaması ve test kanıtlarıyla yapılabilirliği değerlendir. Vizyon, gerçek UYAP yetkisi veya kuruluma ilişkin izin vermez. Repo kökündeki **AGENTS.md** geliştirme ajanlarının uygulama kurallarını tanımlar.

Bu belge kullanıcı kararları değiştikçe güncellenebilir; önemli kapsam değişiklikleri bilinçli olarak kayda geçirilir.
