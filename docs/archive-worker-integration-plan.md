# Worker Archive Guard Integration Plan

Bu belge `feature/archive-engine` üzerinde hazırlanmıştır. `bridge/worker.js` bu branch tarafından değiştirilmez. Entegrasyon Chat-UYAP sahipliğinde yapılacaktır.

## Mevcut risk

`archiveOneFile()` ve `copyIntoArchiveDir()` şu anda SHA eşleşmesi bulduğunda `reusableAssetPath(asset.id)` ile asset'in ilk kalıcı fiziksel lokasyonunu reuse edebiliyor.

Bu seçim hedef dava klasörünü dikkate almadığı için aynı SHA başka bir dava klasöründe mevcutsa worker:
- yeni case klasöründe canonical görünürlük oluşturmadan başka case yolunu `filed_path/archive_path` olarak döndürebilir;
- transient source'u silebilir;
- global SHA dedup ile case-level fiziksel arşiv görünürlüğünü birbirine karıştırabilir.

Ayrıca yeni canonical kopya mevcut worker'da `fs.copyFileSync()` ile oluşturuluyor ve kaynak temizliği öncesinde explicit SHA/byte-size verification yok.

## Hazır bağımsız modül

`bridge/archive_case_guard.js`

API:
- `planCaseCanonical({source, caseArchiveDir, preferredName, assetLocations, expectedSha256})`
- `executeCaseCanonicalPlan(plan)`
- `selectReusableCanonicalPath(locations, caseArchiveDir, {expectedSha256})`

Temel invariantlar:
- yalnız beklenen `caseArchiveDir` içindeki path reuse edilebilir;
- başka case'teki aynı hash reuse edilmez; mevcut case'e verified copy planlanır;
- aynı isim + aynı hash -> aynı target reuse;
- aynı isim + farklı içerik -> `(2)`, `(3)` şeklinde yeni target;
- source hash beklenenden farklıysa canonical'a hiçbir yazma yapılmaz;
- kopya temp dosyaya yapılır, SHA + size doğrulanır, sonra rename edilir;
- helper source'u silmez; cleanup yalnız caller'ın başarılı DB/index aşamasından sonra yapılır.

## Worker entegrasyon noktası 1 — `archiveOneFile()`

Mevcut:
```js
const sha=await hashFile(file);
const asset=db.prepare("SELECT id FROM local_assets WHERE sha256=?").get(sha);
if(asset){
  const existingPath=reusableAssetPath(asset.id);
  if(existingPath){ ... return existingPath; }
}
const finalPath=uniqueArchiveName(destDir,...);
fs.copyFileSync(file,finalPath);
await scanDocuments({roots:[destDir]});
... delete source ...
```

Önerilen akış:
```js
const sha=await hashFile(file);
const asset=db.prepare("SELECT id FROM local_assets WHERE sha256=?").get(sha);
const locations=asset
  ? db.prepare("SELECT local_path FROM asset_locations WHERE asset_id=? ORDER BY id").all(asset.id)
  : [];

const plan=archiveCaseGuard.planCaseCanonical({
  source:file,
  caseArchiveDir:destDir,
  preferredName:preferredName||path.basename(file),
  assetLocations:locations,
  expectedSha256:sha
});
const canonical=archiveCaseGuard.executeCaseCanonicalPlan(plan);

if(!canonical.dedup){
  await scanDocuments({roots:[destDir]});
}
const loc=db.prepare("SELECT asset_id FROM asset_locations WHERE local_path=?").get(canonical.path);
const assetId=loc?.asset_id||asset?.id||null;

// source cleanup yalnız verified canonical + başarılı index/DB adımından sonra
if(path.resolve(file)!==path.resolve(canonical.path) && fs.existsSync(file))fs.unlinkSync(file);
cleanupTransientAssetLocations(assetId,canonical.path);
```

## Worker entegrasyon noktası 2 — `copyIntoArchiveDir()`

Aynı guard akışı kullanılmalıdır. Burada `caseArchiveDir` doğrudan mevcut `destDir` değeridir.

Özellikle ZIP/EYP genişletme ve mevcut fiziksel archive package işleme bu fonksiyondan geçtiği için global `reusableAssetPath()` burada da case/directory scoped hale getirilmelidir.

## Değiştirilmesi gerekmeyen nokta

`archiveExistingUyapDocuments()` başlangıçta mevcut asset locations arasından zaten `expectedDir` altında location arıyor. Bu kontrol case-scope olarak doğru. Ancak daha sonra `archiveWithFormatPolicy()` -> `archiveOneFile()` yoluna düştüğünde yeni guard devreye girmelidir.

## Failure semantics

- plan/hash doğrulaması fail -> source korunur, existing canonical korunur, `filed` yazılmamalı;
- copy doğrulaması fail -> temp silinir, source korunur, existing canonical korunur;
- copy başarı + `scanDocuments` fail -> verified canonical ve source birlikte kalabilir; retry idempotent olmalıdır;
- retry -> aynı case'te aynı hash varsa `already_verified` / dedup sonucu;
- başka case aynı SHA -> o path asla current case canonical olarak dönmez.

## Fixture kabul testleri

`node scripts/archive_case_guard_selftest.js`

Beklenen:
- wrong case same hash not reused
- same hash copied into current case
- same case hash reused
- same-name different-content gets unique target
- existing file not overwritten
- partial source cannot damage canonical
- repeated processing creates no duplicate
- corrupt same-case location rejected
- sources preserved until caller cleanup

Bu entegrasyon `worker.js` üzerinde Chat-UYAP tarafından yapıldıktan sonra archive testleri tekrar çalıştırılmalıdır.
