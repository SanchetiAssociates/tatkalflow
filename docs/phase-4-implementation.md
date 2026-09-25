# Phase 4: implementation notes

How the [Phase 4 specification](phase-4-journey-creation.md) was implemented, and the decisions that need the product owner's attention.

## Data model

| Spec table | Implementation |
|---|---|
| `journeys` | Existing Phase 2 table, extended: `name`, `boarding_station_code`, `rac_waitlist_preference`, `rule_snapshot`, `template_id` (FK, `SET NULL`). |
| `journey_passengers` | Existing, plus `berth_preference` (backfilled from each passenger's saved berth). |
| `journey_trains` | The existing `journey_train_preferences` table (not duplicated). Unique `(journey_id, train_number)` added. |
| `journey_class_preferences` | Existing. Unique `(journey_id, class_code)` added. |
| `journey_templates` | New. User-owned, soft-deleted. |
| `journey_template_passengers` / `_trains` / `_classes` | New, cascade with the template. Passengers are `RESTRICT` (passengers are only ever soft-deleted). |

Migration `20260925112920_phase4_journey_templates` is additive only. The existing `preferences` JSON column is kept for future use; Phase 4 preferences have explicit columns. The existing `tatkal_rule_snapshot` column is left for the Phase 5 date engine; journeys record their creation-time rules in the new `rule_snapshot` column.

**Template vs instance.** A template has no date. Creating a journey from a template copies its rows, so later template edits (or deleting the template) never change the journey. `template_id` is provenance only.

## API

All routes need a bearer token, scope every query by the authenticated user, and answer another user's IDs (and malformed IDs) with 404.

| Route | Purpose |
|---|---|
| `GET /api/journey-options` | Class catalogue, defaults, and rule-driven limits with their verification state |
| `GET /api/trains/search`, `GET /api/trains/:number` | Train provider lookup |
| `GET/POST /api/journey-templates`, `GET/PATCH/DELETE /api/journey-templates/:id` | Templates |
| `POST /api/journey-templates/:id/journeys` | Create a journey from a template |
| `GET/POST /api/journeys`, `GET/PATCH/DELETE /api/journeys/:id` | Journeys (POST still accepts the Phase 3 draft payload) |
| `POST /api/journeys/:id/duplicate` | Duplicate, with a new date and a fresh rule snapshot |
| `GET /api/journeys/:id/readiness` | Booking-readiness preview |
| `PUT/POST /…/:id/passengers`, `DELETE /…/:id/passengers/:passengerId` | For both journeys and templates |
| `PUT/POST /…/:id/trains`, `DELETE /…/:id/trains/:trainNumber` | PUT replaces the ordered list (reorder) |
| `PUT/POST /…/:id/classes`, `DELETE /…/:id/classes/:classCode` | At least one class is kept |

Only `DRAFT` journeys can be edited (`409 JOURNEY_NOT_EDITABLE` otherwise).

## Railway rules: decision needed

The spec supplies three values: **4 passengers per PNR**, **16-character passenger names**, and **no senior-citizen concession on Tatkal**. They are supported as rule keys with typed values:

- `tatkal.max_passengers_per_pnr` (already existed)
- `passenger.name_max_length` (new, critical)
- `tatkal.senior_citizen_concession_available` (new, critical)

**The values have not been added to `apps/api/rules/railway-rules.json`.** Phase 3 established, and its tests enforce (`rules.test.ts`: "ships only values supplied by the product brief", "does not invent rules the brief didn't supply"), that the registry holds exactly the five Phase 3 brief values. Adding entries would mean changing those Phase 3 tests, which this phase was told not to do without cause. Until the entries are added, the app reports these rules as **not configured** and readiness shows warnings; the rule-driven behaviour is exercised in `journeys-rules.test.ts` by syncing test versions through the normal registry path.

To apply them, add these entries (as UNVERIFIED, like the Phase 3 values, or VERIFIED once checked against an official source with `sourceUrl`, `lastVerifiedAt` and `verifiedBy`), update the two Phase 3 registry tests, and run `npm run rules:sync -w @tatkalflow/api`:

```json
{ "ruleKey": "tatkal.max_passengers_per_pnr", "value": 4, "source": "TatkalFlow Phase 4 specification §11 (supplied by product owner). Not yet checked against an official IRCTC / Indian Railways source.", "sourceUrl": null, "effectiveFrom": "2026-01-01T00:00:00.000Z", "effectiveTo": null, "lastVerifiedAt": null, "verifiedBy": null, "verificationStatus": "UNVERIFIED", "status": "ACTIVE", "notes": null },
{ "ruleKey": "passenger.name_max_length", "value": 16, "source": "TatkalFlow Phase 4 specification §12 (supplied by product owner). Not yet checked against an official IRCTC / Indian Railways source.", "sourceUrl": null, "effectiveFrom": "2026-01-01T00:00:00.000Z", "effectiveTo": null, "lastVerifiedAt": null, "verifiedBy": null, "verificationStatus": "UNVERIFIED", "status": "ACTIVE", "notes": "Counted in characters after trimming." },
{ "ruleKey": "tatkal.senior_citizen_concession_available", "value": false, "source": "TatkalFlow Phase 4 specification §13 (supplied by product owner). Not yet checked against an official IRCTC / Indian Railways source.", "sourceUrl": null, "effectiveFrom": "2026-01-01T00:00:00.000Z", "effectiveTo": null, "lastVerifiedAt": null, "verificationStatus": "UNVERIFIED", "verifiedBy": null, "status": "ACTIVE", "notes": null }
```

### How the rules behave

| Rule state | Passenger limit | Name length | Senior concession on Tatkal |
|---|---|---|---|
| Missing | Not enforced; readiness **warns** | Not checked; readiness **warns** | Unavailable (fails closed); readiness notes it |
| Present, unverified | Enforced on save (as in Phase 3); readiness warns "not verified" | Long names **fail** readiness; warns "not verified" | Unavailable even if the value says available |
| Verified | Enforced | Enforced in readiness | Available only if the verified value is `true` |

Names are counted in Unicode characters after trimming. A too-long name doesn't block saving a draft (the name belongs to the passenger master); it makes the journey **Not ready**, with a link to edit the passenger.

## Readiness

`computeReadiness()` in `@tatkalflow/shared` is a pure function. Items are PASS, WARN, FAIL or INFO. Overall: any FAIL → **Not ready**; else any WARN → **Needs attention**; else **Ready**. A journey can't be Ready while any rule it relies on (passenger limit for its quota, name length, and for Tatkal: booking window, timezone, class lists, the opening time for its class types, and the concession rule when someone opted in) is missing, unverified or due for re-verification.

## Trains

`TrainDataProvider` has `search` and `findByNumber`. `MockTrainDataProvider` holds eight fictional trains (numbers 90101–90108, names beginning "Sample"), for development and tests only. Config `TRAIN_DATA_PROVIDER`: `mock` is refused in production; the production default is `none`, where search is empty and train numbers are stored as entered, without names. Train names are always taken from the provider, never from the client. A future licensed timetable source plugs in behind the same interface.

## Not in Phase 4

- No Tatkal opening date or time is calculated. `TatkalDateEngine` (`packages/shared/src/journeys/tatkal-date-engine.ts`) is a type contract only, with no implementation and no callers.
- No scheduler, notifications, booking, IRCTC integration, CAPTCHA handling, scraping or browser automation.
- No new credential fields: the IRCTC link is still user ID only.

## Setup notes found during Phase 4

- `prisma generate` (and so `npm run build`) needs `DATABASE_URL` set even though it doesn't connect.
- On a fresh clone, run `npm run build -w @tatkalflow/shared` and `npm run db:generate -w @tatkalflow/api` before typechecking.
