# Targeted CBS party search

This feature finds a CBS investigation when the investigation number is unknown without scanning all CBS offices or starting document downloads.

## Proven UYAP observations

CBS list:
- POST `/avukat_dosya_sorgula_cbs_brd.ajx`
- observed body keys: `dosyaDurumKod`, `pageSize`, `pageNumber`, `birimId`, `birimTuru2`, `birimTuru3`
- CBS list rows contain case metadata but no party-name field.

Party lookup:
- POST `/dosya_taraf_bilgileri_brd.ajx`
- observed body: `{ "dosyaId": "<opaque>" }`
- completed result objects have `adi`, `rol`, `kisiKurum`.

No guessed UYAP fields are used.

## API

### GET /api/uyap/cbs-party-search-schema
Reports whether both observed schemas are verified.

### GET /api/uyap/cbs-units?ilKodu=N
Returns units only from completed real `cbs.units` results.

### POST /api/uyap/cbs-party-search

Generic input:

```json
{
  "ilKodu": 99,
  "birimId": "9000001",
  "partyName": "runtime-only target",
  "statuses": [0],
  "openedFrom": "2026-09-01",
  "openedTo": "2026-10-01",
  "maxCandidates": 25
}
```

The clear party name is used only to derive an exact normalized hash. It is not written into command payloads, result summaries or audit metadata.

Safeguards:
- unit must exist in a completed real `cbs.units` response;
- date window is mandatory and max 120 days;
- max candidate party lookups is capped at 50;
- only exact normalized `adi` matches are automatic;
- unrelated CBS rows are not inserted into `cases`;
- raw targeted CBS pages and party lists are not retained in command `result_json`;
- no `document.list`;
- no PDF/UDF queue;
- manual download pause is untouched.

### GET /api/uyap/cbs-party-search/:searchId

Contract: `uyap.targeted-cbs-party-search.v1`.

States:
- queued
- running
- completed
- not_found
- ambiguous
- failed
- login_required
- candidate_limit_reached

An uncertain/fuzzy name is never promoted to a definite match.
