# Station master

Stations come from a **complete, versioned dataset**, imported with provenance. The app never ships a hand-picked list.

## Status

**No station dataset is installed.** The source and its licence still need a decision (see the Phase 3 report). Until one is imported, station search clearly says so in the app, and journeys can't be saved.

`apps/api/test/fixtures/stations.test-only.csv` is a 12-row sample used only by automated tests. Never import it into a real database.

## Importing

```bash
npm run stations:import -w @tatkalflow/api -- \
  --file ./stations.csv --version 2026.10 \
  --source "Publisher / dataset name" \
  --source-url https://example.org/dataset --license "Licence name"
```

Formats:
- **CSV** with the header `code,name[,state][,zone][,aliases]`. Separate aliases with `|`.
- **JSON** array of `{ code, name, state?, zone?, aliases? }`.
- **GeoJSON** `FeatureCollection` with those fields in `properties`.

## Safeguards

- **All or nothing.** Every record is validated, and one invalid or duplicate code aborts the whole import. `--dry-run` parses only.
- **Size check.** Datasets under 1,000 stations are refused unless you pass `--allow-small`.
- **Mass-removal check.** A dataset that would deactivate more than 20% of the current stations is refused unless you pass `--force`.
- **Idempotent.** Re-importing identical content (same SHA-256 checksum) does nothing. Reusing a version number for different content is refused.
- **Nothing is deleted.** Stations missing from a new dataset are *deactivated*, so saved journeys and favourites still resolve.
- **Provenance.** Each import records its version, source, URL, licence, record count, checksum and import time in `station_datasets`, and writes an audit-log entry.

## Search

Search runs through `searchStations()` in `@tatkalflow/shared`, portable code with no database extensions. It matches, in order of rank: exact code, code prefix, name or alias prefix, word prefixes, substring, then fuzzy matching (1 typo for words of 4+ letters, 2 for 7+). The same function can run offline in the web app (Phase 11).
