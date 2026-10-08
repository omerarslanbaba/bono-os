# UYAP targeted case search v1

## Verified live observation

Existing BONO observation data contained 18 successful POST observations for:

`https://avukat.uyap.gov.tr/search_phrase_detayli.ajx`

Observed request shape:

```json
{
  "query": {},
  "body": {
    "dosyaDurumKod": 0,
    "pageSize": 500,
    "pageNumber": 1,
    "birimId": "",
    "birimTuru2": "0926",
    "birimTuru3": "1"
  }
}
```

Observed headers included JSON Accept/Content-Type. No cookies, auth headers or session material are stored in this contract.

The endpoint does **not** take year, base number or court name as request fields.

Observed response shape:

```json
[
  [
    {
      "dosyaId": "<opaque>",
      "dosyaNo": "2026/100",
      "dosyaDurumKod": 0,
      "dosyaDurum": "Açık",
      "dosyaTurKod": 15,
      "dosyaTur": "Hukuk Dava Dosyası",
      "birimAdi": "Kocaeli 3. İş Mahkemesi",
      "birimId": "…",
      "birimTuru1": "09",
      "birimTuru2": "0926",
      "birimTuru3": "0992"
    }
  ],
  1
]
```

The second array element is total result count.

## Field mapping

Request:
- `dosyaDurumKod`: open/closed selector
- `pageSize`: 500
- `pageNumber`: pagination
- `birimId`: empty string for category-level search
- `birimTuru2`: selected real unit type code from `case.units[].tablo`
- `birimTuru3`: selected `yargiTuru`

Target matching is performed only on response:
- court: exact normalized `birimAdi`
- year/base number: exact numeric `dosyaNo == YYYY/N`

No `year`, `esasNo`, `baseNumber` or `court` fields are invented in the UYAP request body.

## APIs

### GET /api/uyap/case-search-schema
Returns observed/verified schema status.

### GET /api/uyap/case-search/options
Returns unit types derived from real completed `case.units` results:

```json
{
  "contractVersion": "uyap.case-search-options.v1",
  "ready": true,
  "units": [
    {"yargiTuru":1,"birimTuru2":"0926","label":"İŞ MAHKEMESİ"}
  ]
}
```

### POST /api/uyap/case-search

```json
{
  "yargiTuru": 1,
  "birimTuru2": "0926",
  "court": "Kocaeli 3. İş Mahkemesi",
  "year": 2026,
  "baseNumber": 100,
  "dosyaDurumKod": 0
}
```

Response is HTTP 202. It means queued only.

### GET /api/uyap/case-search/:searchId

Contract: `uyap.targeted-case-search.v1`.

States:
- `queued`
- `running`
- `completed`
- `not_found`
- `ambiguous`
- `failed`
- `login_required`

Only an exact completed match is inserted into BONO `cases`. Other rows returned by UYAP are not persisted as cases by targeted search.

Pagination uses the same `searchId`.

## Safety

Targeted search:
- never calls `document.list`;
- never queues PDF/UDF;
- never clears `manualDownloadPaused`;
- refuses unobserved unit type combinations;
- refuses search when the UYAP session is `login_required`;
- stores only exact-match result summaries for the targeted query, not unrelated result-page rows.
