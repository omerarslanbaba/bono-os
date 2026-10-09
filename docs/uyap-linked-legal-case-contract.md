# BONO OS — Bağlantılı Hukuki Dosyalar Veri Sözleşmesi

Contract: `bono.linked-legal-cases.v1`

Bu sözleşme PR #21'deki bağlantılı dosya ilkelerini izole ve fail-closed bir veri modeli olarak ifade eder. Runtime entegrasyonu, DB migration, sorgu kuyruğu, Bridge ve canlı UYAP davranışı bu teslimin kapsamında değildir.

## 1. Temel ilke: ilişki kimlik birleştirme değildir

Bir hukuki süreç birden fazla UYAP dosyasına yayılabilir:

- eski CBS soruşturması → yeni CBS soruşturması;
- CBS soruşturması → ceza davası;
- ana soruşturma → talimat dosyası;
- ilk derece → istinaf → temyiz.

Her dosya ayrı bir `case node` olarak kalır. Bir ilişki kurulması:

- opaque UYAP `dosyaId` değerini,
- yargı birimi/birim adını,
- dosya/soruşturma esas numarasını,
- BONO case referansını

başka düğümden devralmaz veya üzerine yazmaz.

Doğrulanmış iki farklı UYAP dosyasının aynı opaque `dosyaId` ile iki ayrı case node olarak tanımlanması sözleşme hatasıdır.

## 2. Case node

Örnek:

```json
{
  "nodeId": "cbs-new",
  "bonoCaseId": "local-case-ref",
  "caseKind": "cbs",
  "stage": "investigation",
  "identity": {
    "state": "verified",
    "uyapDosyaId": "<opaque>",
    "unitName": "<gerçek birim>",
    "unitId": "<varsa>",
    "fileNo": "2026/200"
  }
}
```

`identity.state`:

- `verified`
- `unverified`
- `unknown`

`verified` kimlikte `uyapDosyaId + unitName + fileNo` zorunludur. Eksik alan uydurulmaz.

Bu sözleşme PR #17'nin canlı kimlik/aidiyet doğrulamasının yerine geçmez. Entegrasyon katmanı yalnız gerçekten doğruladığı kimlikleri `verified` olarak vermelidir.

## 3. Dosya ilişkisi

Her ilişki ayrı bir edge'dir:

```json
{
  "linkId": "link-new-court",
  "fromCaseNodeId": "cbs-new",
  "toCaseNodeId": "criminal-first",
  "relationType": "prosecution_to_court",
  "state": "verified",
  "evidence": {
    "kind": "explicit_reference",
    "verified": true
  }
}
```

Desteklenen ilişki türleri:

- `cbs_successor`
- `prosecution_to_court`
- `instruction_child`
- `appeal_to`
- `related_other`

Yön, hukuki yaşam döngüsü semantiğini korur. UI belge görünümü için edge'ler bir ilişki yolu olarak iki yönde gezilebilir; bu, edge'in hukuki yönünü değiştirmez.

## 4. İlişki güven düzeyi

### `verified`

Koşullar:

- iki uç case node'un kimliği de `verified`;
- ilişki için ayrı ve `verified:true` kanıt vardır;
- kanıt türü `unknown` veya salt `user_selection` değildir.

Politika:

- `mayAutoTraverse = true`
- doğrulanmış ilişkili dosyalar varsayılan kapsam için değerlendirilebilir.

### `user_selected_unverified`

Kullanıcı iki dosyayı ilişkili seçmiştir ancak sistemsel ilişki kanıtı tamamlanmamıştır.

Koşullar:

- `evidence.kind = user_selection`
- `userSelected = true`
- `verified = false`

Politika:

- ilişki görünür tutulabilir;
- kullanıcı seçimi açıkça gösterilir;
- otomatik traversal/default kapsam yoktur;
- bu seçim hiçbir case kimliğini veya belge aidiyetini doğrulamaz.

Türkçe durum:

`Kullanıcı tarafından ilişkilendirildi; doğrulanmadı`

### `unknown`

Aday veya olası ilişki vardır fakat yeterli kanıt yoktur.

Politika:

- otomatik traversal yok;
- belge bu ilişki üzerinden otomatik gösterilmez;
- `unknown` hiçbir zaman `yok` anlamına gelmez.

Türkçe durum:

`Dosya bağlantısı bilinmiyor`

## 5. Belge kaynağı ve görüntülendiği dosya ayrıdır

Belge kaydı kaynak kimliğini taşır:

```json
{
  "documentKey": "[\"<dosyaId>\",\"<evrakId>\"]",
  "source": {
    "caseNodeId": "cbs-old",
    "uyapDosyaId": "<source dosyaId>",
    "unitName": "<source birim>",
    "fileNo": "2025/100",
    "evrakId": "<source evrakId>",
    "ownershipState": "verified"
  }
}
```

Bir başka dosya ekranında gösterildiğinde yeni bir kaynak kaydı oluşturulmaz ve `source` alanları değiştirilmez.

Görünüm projeksiyonu ayrı çıktı üretir:

```json
{
  "sourceCaseNodeId": "cbs-old",
  "visibleFromCaseNodeId": "criminal-first",
  "state": "verified",
  "sourceUnchanged": true,
  "changesOwnership": false,
  "viaLinkIds": ["link-old-new", "link-new-court"]
}
```

Önemli ayrım:

`document source != visible-from case`

Başka case ekranında görünmek, belgenin UYAP aidiyetini o case'e taşımaz.

## 6. Çok aşamalı görünüm yolu

`projectDocumentView()` bir belgenin kaynak case'inden hedef ekrana kadar açıkça verilen `viaLinkIds` yolunu doğrular.

Sonuç:

- bütün edge'ler `verified` → `state=verified`, otomatik gösterim kapsamına girebilir;
- yolda en az bir `user_selected_unverified` → kullanıcı seçimiyle görünür fakat doğrulanmış/otomatik sayılmaz;
- yolda `unknown` → fail-closed, otomatik görünüm yok;
- kopuk veya yanlış hedefli yol → reddedilir.

Bu model ilk derece → istinaf → temyiz gibi zincirlerde belgeyi yeniden sahiplenmeden görünür kılmaya izin verir.

## 7. Tek fiziksel içerik, ayrı hukuki belge kayıtları

Fiziksel içerik:

```json
{
  "physicalContent": {
    "sha256": "<64 hex>",
    "integrityVerified": true
  }
}
```

`buildPhysicalReuseIndex()` yalnız bütünlüğü doğrulanmış SHA-256 için fiziksel yeniden kullanım anahtarı üretir:

`sha256:<hash>`

Aynı hash'e sahip farklı UYAP belge kayıtları ayrı kalır:

- ayrı `dosyaId`;
- ayrı `evrakId`;
- ayrı kaynak case;
- ayrı provenance/metadata.

Sabit kurallar:

- `hashProvesCaseRelation = false`
- `hashChangesDocumentOwnership = false`

Aynı dosya adı veya yalnız aynı hash hukuki dosya ilişkisini kanıtlamaz.

## 8. Sözleşme doğrulama hataları

Örnek machine-readable kodlar:

- `case.duplicate_uyap_dosya_id`
- `link.unsupported_state`
- `link.unsupported_relation_type`
- `link.verified_requires_verified_case_identities`
- `link.verified_evidence_required`
- `link.user_selection_evidence_required`
- `link.user_selected_must_remain_unverified`
- `document.source_dosya_id_mismatch`
- `document.source_unit_mismatch`
- `document.source_file_no_mismatch`
- `document.verified_integrity_requires_sha256`

Entegrasyon katmanı bu hataları sessizce düzeltmemeli veya başka case kimliğinden alan kopyalayarak kapatmamalıdır.

## 9. Fixture gerçeklik sınırı

`scripts/fixtures/uyap_linked_legal_case_graph.json` içindeki bütün kimlikler sentetiktir.

Fixture metadata:

- `synthetic = true`
- `liveUyapEvidence = false`

Fixture içinde `state=verified` kullanılan örnekler yalnız sözleşmenin doğrulanmış-state davranışını test eder.

**Fixture PASS ≠ gerçek UYAP dosyaları arasındaki bağlantı doğrulandı.**

## 10. Entegrasyon teslim sözleşmesi

Gelecekte runtime/DB entegrasyonu yapılırken:

1. her UYAP dosyası kendi case node'una map edilir;
2. gerçek case identity PR #17 fail-closed kimlik sözleşmesinden gelir;
3. dosyalar arası ilişki ayrı edge kaydıdır;
4. kullanıcı seçimi `user_selected_unverified` olarak kalır; sistem doğrulaması yerine geçmez;
5. belge metadata'sındaki source `dosyaId + evrakId` hiçbir view işlemiyle değiştirilmez;
6. başka case ekranında gösterim ayrı projection/view association olarak tutulur;
7. hash dedup fiziksel blob seviyesindedir; legal document records merge edilmez;
8. PR #22 gözlem kodu veya canlı endpoint sonucu bu modül tarafından çağrılmaz;
9. migration, queue, worker, Bridge ve download izinleri bu sözleşmenin dışında kalır.

## 11. İzole test

```text
node --check contracts/uyap_linked_legal_case_contract.js
node --check scripts/test_uyap_linked_legal_case_contract.js
node scripts/test_uyap_linked_legal_case_contract.js
```

Testler sentetik fixture üzerinde çalışır; canlı Core, DB, Chrome veya UYAP oturumuna erişmez.


## 12. Genel CBS evrak parser çıktısı ile bağlantılı dosya uyumu

Ek sözleşme: `bono.cbs-linked-document-adapter.v1`

Saf adaptör:

`contracts/uyap_cbs_linked_document_adapter.js`

Bu adaptör PR #22 parser'ını çağırmaz ve parser mantığını tekrar etmez. Entegrasyon katmanı parser'ın sanitize edilmiş çıktısını adaptöre verir.

### En küçük parser arayüzü

Adaptör yalnız şu alanları tüketir:

```json
{
  "tumEvraklar": {
    "<dinamik görünüm başlığı>": [
      {
        "dosyaId": "<opaque kaynak>",
        "evrakId": "<opaque evrak>",
        "ggEvrakId": "<opaque görünüm/evrak referansı>",
        "ekEvrakListesi": [
          {
            "anaEvrakId": "<opaque ana evrak referansı>",
            "evrakId": "<opaque ek evrak>",
            "sira": 1,
            "ekTuru": "<tür>"
          }
        ]
      }
    ]
  },
  "son20Evrak": []
}
```

Ek evrakta ayrı `dosyaId` yoksa doğrudan içinde bulunduğu ana evrağın **açık `dosyaId` değeri** kaynak bağlamı olarak kullanılır. Bu yalnız belge kaynak bağlamıdır; `anaEvrakId` semantiği tahmin edilmez. Ek evrak kendi `dosyaId` değerini taşıyıp ana evrakla çelişirse kaynak `unknown` olur.

### Grup başlığı kaynak kimliği değildir

Dinamik `tumEvraklar` object key'i yalnız `displayGroup.title` olarak saklanır.

Sabit kurallar:

- grup başlığı kaynak `dosyaId` değildir;
- grup başlığı `relationType` üretmez;
- grup başlığı `verified` üretmez;
- aynı grup altında birden fazla açık `dosyaId` bulunabilir;
- grup karışık kaynak taşıyorsa tek kaynak case üretmek yasaktır;
- tek kaynak görünse dahi yalnız grup başlığından case oluşturulmaz.

Her occurrence kendi item/ana-evrak kaynak kimliğini taşır.

### Ana evrak ve ek evrak

Her görünüm occurrence'ı ayrı rol taşır:

- `documentRole = main`
- `documentRole = attachment`

Ek evrak ayrıca:

- `anaEvrakId`
- `parentMainEvrakId`
- `parentMainGgEvrakId`
- `sira`
- `ekTuru`

alanlarını ayrı saklar.

`anaEvrakId` ile `evrakId`/`ggEvrakId` arasında gözlemlenmemiş anlam eşlemesi uydurulmaz.

### Legal document identity ve görünüm occurrence

Mükerrerlik anahtarı:

`JSON.stringify([source dosyaId, evrakId])`

`evrakId` tek başına unique kabul edilmez.

Bu nedenle:

- aynı `evrakId` + farklı `dosyaId` = ayrı hukuki evrak kayıtları;
- aynı `dosyaId + evrakId` farklı grup veya `son20Evrak` görünümünde tekrar ederse = tek hukuki evrak kaydı, birden çok görünüm occurrence'ı;
- kaynak `dosyaId` bilinmiyorsa evrak başka occurrence ile otomatik dedup edilmez.

Grup başlığı legal document identity'nin parçası değildir.

### Kaynak dosya ile görüntüleme dosyası

Parser occurrence'ı iki farklı bilgiyi taşır:

1. `observedView`: evrakın hangi BONO/UYAP dosya ekranından gözlemlendiği;
2. `linkedProjection`: kaynak dosya ile görüntüleme dosyası arasındaki bağlantılı-case sözleşmesinin sonucu.

`observedView.visible = true` olması hukuki dosya ilişkisini kanıtlamaz.

`linkedProjection` yalnız mevcut `bono.linked-legal-cases.v1` graph'ı ve açıkça verilen ilişki yolu üzerinden hesaplanır.

### İndirme kapsamı

`buildAutomaticDownloadScope()` yalnız şu durumda evrakı otomatik aday yapar:

- kaynak `dosyaId + evrakId` biliniyor;
- kaynak `dosyaId`, graph içindeki doğrulanmış case identity ile exact eşleşiyor;
- belge kendi kaynak dosyasından görüntüleniyor **veya** görüntüleme dosyasına giden ilişki yolu tamamen `verified`;
- linked projection `mayAutoInclude=true`.

Şunlar otomatik kapsam dışıdır:

- `user_selected_unverified`;
- `unknown` ilişki;
- graph'ta bulunmayan kaynak `dosyaId`;
- eksik kaynak `dosyaId`;
- çelişkili ek-evrak kaynak kimliği.

Kullanıcı seçimi görünümü mümkün kılabilir; otomatik indirme yetkisi üretmez.

### Chat-3 parser birleşim noktası

Parser tarafında gereken **en küçük çıktı**:

- `tumEvraklar` dinamik grup object'i;
- ana item'da `dosyaId`, `evrakId`, `ggEvrakId`;
- nested `ekEvrakListesi` ve içindeki `anaEvrakId`, `evrakId`, `sira`, `ekTuru`;
- varsa `son20Evrak`.

Adapter tarafına ayrıca runtime entegrasyonu şu üç şeyi verir:

- `linkedCaseGraph`;
- `displayCaseNodeId`;
- kaynak case node bazında açık `viewPathsBySourceCaseNodeId`.

Parser'ın grup başlığından case/link/verified üretmesi gerekmez ve istenmez.

Bu arayüz Core, Bridge, DB, migration veya download motoru davranışı tanımlamaz.


## 13. PR #22 `bono.cbs-document-list.v1` → PR #24 aidiyet kabulü

Kabul referansı: PR #22 head `4965f588a79950376fe144f53c4f3c94fdcd1771`.

PR #22'nin yayınlanmış parser çıktısı ham `tumEvraklar/son20Evrak` ağacı değildir. Parser şu normalize edilmiş yapıyı yayınlar:

- `groups[]`
- `occurrences[]`
- `logicalDocuments[]`
- `binding`
- `completeness`
- parse/request durumları ve güvenlik bayrakları.

Bu nedenle PR #24'ün önceki ham-response adaptörü parser implementasyonuna bağlanmaz. Yayınlanmış parser çıktısı için en küçük uyumluluk sınırı:

`contracts/uyap_cbs_document_list_compat.js`

Contract:

`bono.cbs-document-list-linked-compat.v1`

Kaynak contract yalnız:

`bono.cbs-document-list.v1`

olarak kabul edilir.

### Alan eşleştirme tablosu

| PR #22 alanı | Yayınlanmış tip | PR #24 karşılığı | Aidiyet kuralı |
| --- | --- | --- | --- |
| `occurrence.source.uyapDosyaId` | non-empty string veya `null` | `occurrence.source.uyapDosyaId` | Karakterleri aynen korunur; trim/decode/alias yoktur. |
| `occurrence.metadata.dosyaId` | scalar, varsa string | source ile çapraz doğrulama | Varsa `source.uyapDosyaId` ile exact aynı olmalıdır; farklıysa kabul reddedilir. |
| `occurrence.source.evrakId` | non-empty string veya `null` | `occurrence.source.evrakId` | Exact korunur; tek başına global unique sayılmaz. |
| `occurrence.metadata.evrakId` | scalar, varsa string | source ile çapraz doğrulama | Varsa source `evrakId` ile exact aynı olmalıdır. |
| `occurrence.metadata.ggEvrakId` | optional scalar | `occurrence.metadata.ggEvrakId` | Tip ve değer kayıpsız korunur; source-case kimliği değildir. |
| `occurrence.reportedParentId` / `metadata.anaEvrakId` | optional scalar | `metadata.anaEvrakId`, `attachment.anaEvrakId` | Tip korunur. İkisi birlikte varsa `Object.is` eşitliği gerekir. Parent `evrakId` eşitliği varsayılmaz. |
| `occurrence.metadata.sira` | optional scalar | `metadata.sira`, `attachment.sira` | Number/string ayrımı dahil tip korunur; coercion yoktur. |
| `occurrence.metadata.ekTuru` | optional scalar | `metadata.ekTuru`, `attachment.ekTuru` | Kayıpsız korunur; ilişki türüne çevrilmez. |
| `occurrence.kind` | `main\|attachment` | `documentRole` | Ana evrak ve ek evrak ayrı kalır. |
| `occurrence.parentReference` | string veya `null` | `attachment.parentReference` | Yalnız parser occurrence bağıdır; eksik `dosyaId` üretmek için kullanılmaz. |
| `occurrence.visibleFromUyapDosyaId` | string veya `null` | `observedView.visibleFromUyapDosyaId` | Kaynak `dosyaId`'den ayrıdır. Verified projection için seçilen display case kimliğiyle exact eşleşmelidir. |
| `occurrence.relationshipState` | `verified\|unknown` | `source.parserRelationshipState` | Yalnız parser'ın hedef-panel kaynak eşleşme kanıtı olarak korunur; yabancı dosya ilişkisi üretmez. |
| `group.relationshipState` | `unknown\|user_selected_unverified` | `parserGroup.relationshipState` | Review/display durumudur; occurrence ownership veya graph link verification üretmez. |
| `group.sourceIds[]` | exact string listesi | `parserGroup.sourceIds[]` | Görünür kaynak çeşitliliği korunur; grup için tek source case oluşturulmaz. |
| `occurrence.logicalKey` | JSON-stringified `[dosyaId, evrakId]` veya `null` | `legalDocumentKey` | Exact source tuple ile yeniden hesaplanıp karşılaştırılır. Delimiter concatenation kullanılmaz. |
| `logicalDocuments[].key/source` | exact tuple kimliği | computed legal-document index ile çapraz doğrulama | Parser logical identity ile adapter identity uyuşmazsa fail-closed. |

### Opaque kimlik düzeltmesi

PR #22 sözleşmesi opaque UYAP kimliklerinde whitespace, quote ve diğer karakterlerin anlamlı olabileceğini açıkça korur.

Bu kabul ile PR #24 de aynı kurala geçirilmiştir:

- `uyapDosyaId` trim edilmez;
- `evrakId` trim edilmez;
- legal document key artık delimiter birleştirmesi değildir;
- key `JSON.stringify([dosyaId, evrakId])` ile collision-safe üretilir.

Dolayısıyla:

`["a::b", "c"] != ["a", "b::c"]`

ve iki kayıt yanlış mükerrer sayılamaz.

### Ek evrak source kuralı

PR #22 parser'ı ek evrakta eksik `dosyaId` değerini enclosing ana evraktan onarmaz.

PR #24 de aynı fail-closed kurala geçirilmiştir:

- ek evrak kendi `dosyaId` değerini taşıyorsa exact source olarak korunur;
- taşımıyorsa source `unknown` kalır;
- `parentReference`, `anaEvrakId` veya nesting source `dosyaId` üretmez;
- explicit attachment source ana evrak source'undan farklıysa explicit değer kaybolmaz; yalnız parent/source farkı ayrı diagnostic bağlamıdır.

### Üç ilişki durumu

PR #22 parser sonucu ile PR #24 linked graph farklı kanıt katmanlarıdır.

- **`verified`**: source case identity bağımsız olarak verified ve display case'e verilen graph yolu tamamen verified olmalıdır. Hedef dosyanın kendi occurrence'ında ayrıca PR #22 target ownership/binding kanıtı verified olmalıdır.
- **`user_selected_unverified`**: yalnız linked graph'taki kullanıcı seçimi edge'inden gelir; görünüm mümkün olsa bile automatic related scope'a girmez.
- **`unknown`**: source kimliği eksik, display kimliği uyuşmuyor, parser evidence eksik veya ilişki yolu unknown ise korunur; otomatik olarak yükseltilmez.

Parser group selection hiçbir occurrence'ı `verified` yapmaz.

### Kabul sonucu ve runtime sınırı

Compat adapter yalnız metadata aidiyeti için saf bir sözleşme katmanıdır.

Her occurrence için:

- `runtimeMetadataImportAllowed = false`
- `runtimeDownloadAllowed = false`

olarak kalır.

Bu kabul Core import, DB write, download queue veya canlı UYAP işlem yetkisi vermez.

### Kalan gerçek kanıtlar

Sentetik kabul testleri alan/shape ve fail-closed aidiyet kurallarını doğrular; aşağıdaki gerçek kanıtların yerine geçmez:

1. Gerçek response'un aynı verified CBS paneli, request ve response context'iyle causal binding'i PR #22 tarafından doğrulanmalıdır.
2. Display dosyası dışındaki CBS/talimat `dosyaId` değerleri için bağımsız gerçek case identity kanıtı gerekir; yalnız parser'da görünmek source case node'u yaratmaz.
3. Eski CBS → yeni CBS, CBS → talimat veya diğer hukuki ilişki için ayrı ilişki kanıtı gerekir. Grup `display.fileNo/type`, grup başlığı, aynı panelde görünme veya kullanıcı seçimi `verified` link kanıtı değildir.
4. Kendi `dosyaId` değeri bulunmayan ek evrak source'u gerçek kanıt gelene kadar `unknown` kalır.
5. `pageTotal` anlamı ve liste/pagination completeness hâlen ayrı kanıttır.
6. Viewer/download reference, fiziksel indirme ve SHA-256 bütünlük doğrulaması bu metadata kabulünden ayrıdır.
7. Opaque `dosyaId` değerlerinin zaman içindeki alias/eşdeğerliği gözlem olmadan varsayılmaz.
