# BONO OS — UYAP Tek Dosya / Evrak Aidiyeti Sözleşmesi

Contract: `uyap.single-case-evidence.v1`

Bu sözleşme, bir BONO dosyasının UYAP kimliği ile evrak metadata'sının birbirine karışmadan bağlanmasını ve "bulundu / listelendi / doğrulandı / indirildi / hash doğrulandı" aşamalarının ayrı tutulmasını tanımlar.

## Ürün ilkesi

Aşağıdaki durumlar aynı şey değildir:

1. Dosya UYAP'ta bulundu.
2. Bulunan satır hedef mahkeme/birim + esas/soruşturma numarasıyla exact eşleşti.
3. Hedef UYAP `dosyaId` kimliği elde edildi.
4. `document.list` tamamlandı.
5. Evrak item'i hedef `dosyaId` ile exact aidiyet gösterdi.
6. Metadata BONO `uyap_remote_documents` satırına doğru bağlandı.
7. Belge fiziksel olarak indirildi.
8. Yerel/canonical içerik hash ile doğrulandı.

Bir üst aşama alt aşamaları otomatik olarak kanıtlamaz.

## Bağımsız doğrulama modülü

`bridge/uyap_case_document_contract.js`

Modül UYAP endpointi çağırmaz, queue'ya yazmaz, migration yapmaz ve worker claim davranışına dokunmaz.

Başlıca fonksiyonlar:

- `verifyCaseIdentity(target, observed, evidence)`
- `validateDocumentListOwnership(caseIdentity, data)`
- `classifyDocumentOwnership(caseIdentity, item)`
- `verifyPersistedRemoteOwnership(caseIdentity, remoteRow)`
- `buildSingleCaseLifecycle(input)`
- `queryCapability(request, observedSchemas)`

## Dosya kimliği

Hedef case kimliği şu üç parçayla temsil edilir:

- normalize edilmiş birim/mahkeme adı;
- normalize edilmiş dosya numarası (`YYYY/N`);
- opaque UYAP `dosyaId`.

### Exact case doğrulaması

Targeted case search için:

- mahkeme/birim adı response üzerinde exact normalize eşleşmelidir;
- `dosyaNo` exact `YYYY/N` eşleşmelidir;
- response'ta opaque `dosyaId` bulunmalıdır;
- target zaten bir `uyapDosyaId` taşıyorsa observed `dosyaId` de exact aynı olmalıdır.

Eksik veya çelişkili alanlar `verified` sayılmaz.

## Evrak aidiyeti

`document.list` içindeki her item ayrı doğrulanır.

Bir item ancak şu koşullarda hedef dosyaya otomatik bağlanabilir:

- hedef case'in doğrulanmış/bağlı `uyapDosyaId` değeri mevcut;
- item'da `dosyaId` mevcut;
- item `dosyaId` hedef `uyapDosyaId` ile **exact** aynı;
- item'da `evrakId` mevcut.

Doğrulanmış ownership key:

`<uyapDosyaId>::<evrakId>`

### Fail-closed sınıfları

- `owned`: exact target `dosyaId` + `evrakId`.
- `foreign`: item `dosyaId` başka UYAP dosyasına ait.
- `unverified`: item `dosyaId` veya `evrakId` eksik.
- bilinmeyen document-list response şekli: tamamen `rejected`.

## CBS / talimat / grup güvenliği

`tumEvraklar` object biçiminde farklı gruplar içerebilir. Object key / `__uyapGroup` yalnız bağlamsal metadata'dır; **aidiyet kanıtı değildir**.

Örneğin:

- hedef soruşturma evrakı → item `dosyaId == target dosyaId`: owned;
- başka CBS soruşturma item'i → farklı `dosyaId`: foreign;
- talimat item'i → farklı talimat `dosyaId`: foreign;
- yalnız "TALİMAT EVRAKLARI" grup adı var ama item `dosyaId` yok: unverified.

Karışık response'ta owned item bulunması tüm response'u güvenli yapmaz. `validateDocumentListOwnership()` böyle bir response'u `partial` / `failClosed=true` üretir.

Runtime entegrasyonu yapıldığında yalnız `owned` item'lar persist/import edilmeli; foreign/unverified item'lar hedef case'e yazılmamalıdır.

## Persist edilmiş remote metadata doğrulaması

Mevcut `uyap_remote_documents` satırı için:

- `metadata_json.dosyaId` target UYAP dosya ID'siyle exact eşleşmeli;
- `metadata_json.evrakId` ile satırdaki `remote_document_id` exact eşleşmeli.

Bunlardan biri yoksa veya farklıysa metadata `verified` değildir.

Bu kontrol özellikle daha önce broad/group response'tan yanlış case altında persist edilmiş olabilecek satırları audit etmek için kullanılabilir.

## Durum modeli

`buildSingleCaseLifecycle()` beş ayrı aşama döndürür:

### 1. caseDiscovery

- `not_found`
- `found_unverified`
- `identity_mismatch`
- `found_verified`

### 2. documentList

- `not_requested`
- `queued`
- `running`
- `failed`
- `completed_unverified`
- `completed_partial`
- `completed_verified`

### 3. metadataBinding

- `none`
- `rejected`
- `partial`
- `verified`

### 4. download

- `none`
- `not_downloaded`
- `partial`
- `downloaded`

### 5. integrity

- `none`
- `unverified`
- `partial`
- `verified`

Örnek:

`caseDiscovery=found_verified` + `documentList=completed_verified` + `metadataBinding=verified` + `download=not_downloaded`

tamamen geçerli bir durumdur. "Dosya güncel / evrak indirildi" diye yükseltilmez.

## Tek dosya için yeni evrak kontrolü

Zaten UYAP `dosyaId` ile bağlı bir case için desteklenen güvenli akış:

1. `POST /api/uyap/cases/:caseId/sync-documents`
2. mevcut `enqueueCaseDocumentSync(caseId)`
3. yalnız `document.list`
4. `GET /api/uyap/cases/:caseId/document-sync-status`
5. terminal success yalnız gerçek completed/empty sonucu
6. metadata aidiyet doğrulaması
7. indirme ayrı explicit işlem

Bu işlem PDF/UDF download kuyruğunu kendiliğinden başlatmamalı ve manual download pause'u değiştirmemelidir.

## Desteklenen sorgular

| Akış | Durum | Kanıt |
|---|---|---|
| UYAP dosyaId'si zaten bağlı case için `document.list` refresh | Destekleniyor | Mevcut single-case sync sözleşmesi ve fixture |
| Gözlenmiş `case.search` şemasıyla targeted mahkeme/yıl/esas araması | Destekleniyor | `/search_phrase_detayli.ajx` gözlemi; exact response filtering |
| CBS taraf adı + doğrulanmış birim + tarih aralığı ile targeted party search | Destekleniyor | Gözlenmiş CBS list + party lookup şemaları |
| Doğrudan CBS soruşturma numarasıyla yeni UYAP sorgusu | **Desteklenmiyor / fail-closed** | Bu doğrudan query schema gözlenmedi |
| Talimat dosyasını doğrudan sorgulama | **Desteklenmiyor / fail-closed** | Talimat query/group ownership sözleşmesi gözlenmedi |
| Item'da `dosyaId` olmadan grup adına göre otomatik aidiyet | **Desteklenmiyor / fail-closed** | Grup etiketi aidiyet kanıtı değil |
| Bilinmeyen future query kind | **Desteklenmiyor / fail-closed** | Endpoint/parametre tahmini yasak |

## Eskişehir CBS 2026/51832 — case 93

Bu senaryo fixture'da kullanılmıştır:

- BONO case referansı: `93`
- hedef birim: `Eskişehir Cumhuriyet Başsavcılığı`
- hedef soruşturma no: `2026/51832`

Ancak repo içinde bu dosyaya ait gerçek UYAP response payload'ı veya gerçek opaque `dosyaId` kanıtı bulunmamaktadır.

PR #13 de açıkça şu alanları hâlâ canlı kanıt bekleyen başlıklar olarak kaydediyor:

- case 93 identity;
- real CBS response semantics;
- document ownership.

Bu nedenle fixture'daki opaque ID'ler sentetiktir ve:

`liveUyapEvidence=false`

olarak işaretlenmiştir.

**Fixture PASS = sözleşme/test davranışı doğrulandı.**
**Fixture PASS ≠ Eskişehir 2026/51832 canlı UYAP aidiyeti doğrulandı.**

Canlı doğrulama ancak ayrı, yetkili ve dar kapsamlı observation ile yapılabilir.

## Runtime entegrasyon noktası

Mevcut `upsertRemoteList(caseId, data)` bugün response item'larını doğrudan verilen `caseId` altına yazmaktadır.

Güvenli gelecek entegrasyonu:

1. target case'in `uyap_dosya_id` değerinden case identity oluştur;
2. `validateDocumentListOwnership(...)` çalıştır;
3. yalnız `owned` item'ları upsert et;
4. foreign/unverified item'ları target case'e persist etme;
5. list response mixed ise sync durumunu `completed_verified` gibi göstermeden partial/unverified olarak raporla.

Bu entegrasyon shared `uyap.js` üzerinde yapılacağı için mevcut görevde uygulanmamıştır; queue/history/migration/worker claim/LOCAL-RETURN-HOLD sahipliğine dokunulmamıştır.

## Test

`node scripts/test_uyap_case_document_contract.js`

İzole detached worktree sonucu:

- yeni aidiyet sözleşmesi: 21 PASS
- existing single-case sync: PASS
- existing targeted case search: PASS
- existing CBS party search: PASS

Canlı UYAP isteği, live Core, DB veya queue kullanılmamıştır.
