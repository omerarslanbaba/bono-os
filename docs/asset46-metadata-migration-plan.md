# Asset 46 Metadata Migration Plan

Bu plan yalnız metadata migrasyonunu tarif eder. Canonical fiziksel kopya zaten oluşturulmuş ve SHA-256 ile doğrulanmıştır.

## Kimlikler

- Asset ID: `46`
- Remote document ID: `74`
- Beklenen SHA-256: `5c620fb763693933fc27cab5c56141eb8f20d57360f9534338427aa7d6357a0c`
- Kaynak: `C:\Users\omera\Downloads\(2)CevapDilekcesi.pdf`
- Canonical hedef: `C:\Users\omera\OneDrive\Masaüstü\Dava Dosyaları\Asliye Hukuk Mahkemesi\Körfez 2. Asliye Hukuk Mahkemesi - 2026-218\Cevap Dilekcesi - 2026-09-14.pdf`

## Uygulamadan önce

Migration script varsayılan olarak **plan/read-only** modundadır.

Beklenen mevcut durum:

- asset 46 SHA-256 beklenen değerle aynı
- remote doc 74 asset 46'yı referans ediyor
- `filed_path` Downloads kaynağını gösteriyor
- asset location setinde Downloads kaynağı mevcut
- canonical fiziksel hedef mevcut
- source ve target hash + byte size aynı

Bu şartlardan biri sağlanmazsa apply yapılmamalıdır.

## Apply sırasında planlanan değişiklikler

Açık kullanıcı onayı verildiğinde:

1. İşlem öncesi JSON snapshot oluştur.
2. `BEGIN IMMEDIATE` transaction başlat.
3. Canonical path başka asset'e aitse abort et.
4. Asset 46 için canonical target'ı ikinci `asset_location` olarak ekle/reuse et.
5. Downloads asset location'ını koru.
6. `local_assets.archive_path` değerini canonical target'a geçir.
7. `original_extension=.pdf`, `archive_extension=.pdf`, `archive_policy=keep_original` değerlerini koru/doğrula.
8. Remote doc 74 `filed_path` değerini canonical target'a geçir.
9. Remote doc 74 `local_asset_id=46`, `status=filed` olarak kalır.
10. Transaction commit sonrası source/target SHA-256 ve byte size tekrar doğrulanır.

**Apply komutu açık confirmation tokenı olmadan çalışmaz.**

## Apply sonrası beklenen durum

- Downloads dosyası fiziksel olarak mevcut
- canonical dosya fiziksel olarak mevcut
- iki dosyanın SHA-256 değeri eşit
- asset 46 iki fiziksel location görür: Downloads + canonical archive
- `local_assets.archive_path` canonical archive yolunu gösterir
- remote doc 74 `filed_path` canonical archive yolunu gösterir
- hiçbir fiziksel kaynak silinmez

## Rollback

Apply öncesi oluşturulan JSON snapshot kullanılır.

Rollback:

1. transaction açar
2. apply öncesinde canonical asset_location yoksa yalnız DB'deki canonical location kaydını kaldırır
3. `local_assets` metadata alanlarını snapshot değerlerine geri getirir
4. remote doc 74 metadata alanlarını snapshot değerlerine geri getirir
5. Downloads kaynağını silmez
6. canonical fiziksel kopyayı silmez

Rollback da ayrı confirmation tokenı gerektirir.

## Güvenlik

- Bu belge veya script canlı DB migrasyonuna onay teşkil etmez.
- Kullanıcı açıkça onay verene kadar yalnız plan modu kullanılacaktır.
- Fiziksel canonical dosya ve Downloads kaynağı metadata rollback sırasında korunacaktır.
