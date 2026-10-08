# BONO OS — UYAP sorgu capability / diagnostic sözleşmesi

Contract: `uyap.query-capability-diagnostic.v1`

Amaç: bir BONO dosyası için **hangi UYAP işleminin gerçekten desteklendiğini**, hangi kanıtın eksik olduğunu ve güvenli bir sonraki adımı yan etkisiz biçimde açıklamak.

Bu modül UYAP isteği göndermez, queue/history/migration/worker dosyalarına yazmaz, metadata upsert etmez ve belge indirmez. Runtime bağlantısı CHAT-4 entegrasyon katmanına bırakılmıştır.

## Dosyalar

- `bridge/uyap_query_capability_contract.js`
- `scripts/fixtures/uyap_query_capability_cases.json`
- `scripts/test_uyap_query_capability_contract.js`

Aidiyet mantığı yeniden yazılmaz. Evrak response'u verildiğinde mevcut PR #17 modülü olan `bridge/uyap_case_document_contract.js` içindeki `validateDocumentListOwnership()` çağrılır.

## Ana çıktı

`diagnoseUyapCaseCapability(input)` şu alanları üretir:

- `caseKind`: `court | cbs | enforcement | instruction | unknown`
- `supportState`: `supported | unsupported | verification_pending`
- `availabilityState`: `ready | blocked | unsupported | verification_pending`
- `identity`: UYAP kimliği canlı olarak doğrulanmış mı?
- `flows.discovery`: dosya keşif/sorgu akışının destek durumu
- `flows.documentList`: linked-case `document.list` akışının destek durumu
- `documentListEvidence`: gerçek endpoint + gerçek response şekli kanıtı var mı?
- `ownership`: PR #17 aidiyet doğrulamasının sonucu
- `session`: UYAP oturum durumu
- `primaryBlocker`: makine kodu + Türkçe kısa açıklama
- `missingEvidence[]`: eksik kanıt kodları
- `permissions`: keşif, `document.list`, evrak bağlama izinleri
- `safeNextAction`: güvenli sonraki adım kodu + Türkçe açıklama
- `userStatus.shortTr`: kullanıcıya gösterilecek kısa Türkçe durum

`supportState` ile `availabilityState` özellikle ayrıdır. Örneğin akış desteklenebilir; fakat `SESSION_LOGIN_REQUIRED` nedeniyle o anda çalıştırılamaz.

## Canlı kanıt kuralı

`verified:true` tek başına canlı UYAP kanıtı sayılmaz.

Bir kanıt ancak:

1. `liveObserved === true` ise,
2. kaynak etiketi fixture/synthetic/test/mock/fake olarak işaretli değilse ve
3. `sourceType`, yetkili canlı gözlem türlerinden biri ise (`authorized observation`, `live observation`, `persisted live observation`, `uyap observation`)

canlı kabul edilir. Yalnız `liveObserved:true` verilmesi yeterli değildir.

Bu nedenle PR #17'deki sentetik fixture kimliği structural olarak eşleşse bile canlı capability üretmez.

### Case 93

Case 93 için mevcut fixture opaque ID'si sentetiktir. Yeni sözleşme bu girdiyi:

- `identity.state = verification_pending`
- `identity.liveVerified = false`
- `permissions.canQueryDocumentList = false`
- `permissions.canBindDocuments = false`
- `primaryBlocker.code = IDENTITY_LIVE_EVIDENCE_REQUIRED`

olarak sınıflandırır.

Fixture PASS, Case 93 için canlı UYAP doğrulaması değildir.

## Dosya türü matrisi

### Mahkeme (`court`)

Keşif akışı:
- gözlenmiş ve canlı doğrulanmış `case.search` şeması varsa `targeted_case_search` desteklenir;
- canlı şema kanıtı yoksa `verification_pending`.

Linked-case `document.list`:
- uygulama akışı mevcuttur;
- ancak sorgu izni için canlı doğrulanmış case identity + gerçek `document.list` endpoint/response kanıtı + hazır oturum gerekir.

### CBS (`cbs`)

Keşif akışı:
- doğrulanmış CBS liste + party lookup şemaları ile `cbs_party_search` desteklenir;
- **doğrudan soruşturma numarası sorgusu desteklenmez** (`DIRECT_CBS_NUMBER_FLOW_UNSUPPORTED`).

Linked-case `document.list`:
- doğrulanmış case identity üzerinden çalıştırılabilir;
- `SORUŞTURMA EVRAKLARI`, `TALİMAT EVRAKLARI` gibi grup başlıkları aidiyet kanıtı değildir;
- her item PR #17 sözleşmesindeki exact `dosyaId + evrakId` kontrolünden geçer;
- mixed/foreign/unverified response otomatik bağlama yetkisi vermez.

### İcra (`enforcement`)

İcra için generic mahkeme akışının otomatik olarak geçerli olduğu varsayılmaz.

- keşif akışı, icraya özgü canlı gözlem kanıtı gelene kadar `verification_pending`;
- `document.list`, kanıt `caseKinds` içinde `enforcement` kapsamını açıkça taşımadıkça `verification_pending`.

Bu ayrım, mahkeme fixture'ının icra desteği gibi gösterilmesini engeller.

### Talimat (`instruction`)

Mevcut sözleşmede:

- doğrudan talimat sorgusu `unsupported`;
- talimat `document.list` akışı da doğrulanmış sayılmaz;
- yalnız grup etiketiyle hedef dosyaya bağlama yapılamaz.

Yeni canlı endpoint/response + identity + ownership kanıtı elde edilirse bu durum ancak sözleşme sürümü güncellenerek açılmalıdır.

## `document.list` endpoint/response kanıtı

Repo içinde `document.list` queue/runtime yolu ve fixture testleri bulunması, kendi başına canlı endpoint/response kanıtı değildir.

`documentListEvidence` aşağıdaki bilgileri ayrı tutar:

- `endpointObserved`
- `path`
- `method`
- `responseObserved`
- `responseShapeRecognized` / `responseShape`
- `liveObserved`
- gerekiyorsa `caseKinds[]`

Bunlardan biri eksikse `DOCUMENT_LIST_LIVE_EVIDENCE_REQUIRED` üretilir.

Özellikle testlerde kullanılan endpoint kaydı veya sentetik `tumEvraklar` payload'u canlı kanıt sayılmaz.

## Engel kategorileri

Makine tarafından okunabilir `primaryBlocker.category` örnekleri:

- `unsupported_flow`
- `identity_mismatch`
- `verification_pending`
- `session`
- `transient_error`
- `ownership`

Önemli kodlar:

| Kod | Anlam |
|---|---|
| `IDENTITY_MISMATCH` | Hedef dosya ile UYAP identity çelişiyor |
| `IDENTITY_LIVE_EVIDENCE_REQUIRED` | Structural/sentetik eşleşme var ama canlı kanıt yok |
| `DOCUMENT_LIST_LIVE_EVIDENCE_REQUIRED` | Gerçek endpoint/response kanıtı eksik |
| `DIRECT_CBS_NUMBER_FLOW_UNSUPPORTED` | Soruşturma numarasıyla doğrudan CBS sorgusu gözlenmedi |
| `TALIMAT_DIRECT_FLOW_UNSUPPORTED` | Doğrudan talimat sorgusu gözlenmedi |
| `ENFORCEMENT_DOCUMENT_FLOW_UNVERIFIED` | İcraya özgü document.list kanıtı yok |
| `SESSION_LOGIN_REQUIRED` | UYAP oturumu gerekli |
| `TRANSIENT_UYAP_ERROR` | 408/429/5xx/timeout/network gibi geçici hata |
| `OWNERSHIP_MIXED_OR_UNVERIFIED` | Response içinde owned + foreign/unverified karışımı var |
| `OWNERSHIP_FOREIGN_ITEMS_PRESENT` | Başka dosyaya ait item kanıtı var |

HTTP 200 tek başına başarı veya aidiyet kanıtı sayılmaz.

## Güvenli sonraki işlem

Örnek `safeNextAction.code` değerleri:

- `RUN_VERIFIED_DISCOVERY_FLOW`
- `RUN_DOCUMENT_LIST_READ_ONLY`
- `RESTORE_UYAP_SESSION`
- `RETRY_READ_ONLY_QUERY`
- `VALIDATE_DOCUMENT_OWNERSHIP`
- `OBSERVE_DOCUMENT_LIST_CONTRACT`
- `OBSERVE_ENFORCEMENT_FLOW`
- `OBSERVE_TALIMAT_FLOW`
- `USE_CBS_PARTY_SEARCH`
- `REVIEW_IDENTITY`
- `NO_AUTOMATIC_ACTION`

Bu kodlar işlem yürütmez; yalnız entegrasyon katmanına güvenli öneri verir.

## CHAT-4 entegrasyon sözleşmesi

### Sorgu öncesi

CHAT-4 runtime şu verileri diagnostic modülüne verir:

1. case türü / birim bilgisi;
2. PR #17 identity sonucu ile `liveObserved` + güvenilir `sourceType` kanıtı;
3. ilgili discovery schema evidence;
4. gerçek `document.list` observation evidence;
5. session state ve varsa son hata.

`permissions.canQueryDocumentList === true` olmadan diagnostic katmanı sorgunun desteklendiğini/executable olduğunu iddia etmez.

### Response sonrası

1. gerçek response, PR #17 `validateDocumentListOwnership()` ile doğrulanır;
2. validation sonucu + kanıt kaynağı diagnostic'e verilir;
3. `permissions.canBindDocuments === true` olmadan hiçbir item target case'e otomatik bağlanmış kabul edilmez;
4. runtime `upsertRemoteList` filtresi/bağlantısı CHAT-4'ün sorumluluğudur.

Bu görev `upsertRemoteList`, queue, history, migration, worker/core veya download akışını değiştirmez.

## Test

```bash
node --check bridge/uyap_query_capability_contract.js
node --check scripts/test_uyap_query_capability_contract.js
node scripts/test_uyap_query_capability_contract.js
```

Fixture dosyası açıkça:

- `synthetic: true`
- `liveUyapEvidence: false`

olarak işaretlidir. `liveObserved:true` test senaryoları yalnız state-machine davranışını simüle eder; canlı UYAP doğrulaması değildir.
