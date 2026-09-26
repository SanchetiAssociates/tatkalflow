# Phase 5 preparation — Tatkal Date Engine

**Status: specification and architecture approved; Step 0 (official rule verification) PARTIAL. No Phase 5 code exists.**

This file records decisions made with the product owner on 2026-09-25/26 so they survive outside the chat history. It changes nothing in the application. Railway facts here are only as good as the evidence noted against them.

## 1. Objective

Calculate the applicable Tatkal booking opening date/time for a journey and expose that calculation safely. The engine is deterministic and rule-driven. It never books, never contacts IRCTC, never handles CAPTCHA, never claims seat availability and never guarantees a booking.

## 2. Approved architecture decisions (locked)

1. The TatkalDateEngine is a deterministic pure domain calculator (no I/O, no clock, no network, no process/browser timezone dependence).
2. An application/API service gathers the authenticated user's journey, train facts and verified rules, then calls the calculator.
3. Calculation fails closed unless every required rule is ACTIVE, VERIFIED, has an https `sourceUrl`, `lastVerifiedAt` and `verifiedBy`, is within its re-verification period, and is type-valid. This applies in every environment (stricter than `RailwayRulesService.getForBooking`, which only enforces in production).
4. Missing, unverified, conflicting, malformed or ambiguous rules never produce an opening timestamp.
5. Results are calculated per (train, class).
6. Journey-level results may group identical opening moments; the per-train/per-class result is the source of truth.
7. `earliestOpensAt` is display ordering only.
8. Calculation records are immutable / insert-only.
9. Each record carries enough rule and input provenance to answer "Why did TatkalFlow calculate this opening time?" (rule values, status, sourceUrl, lastVerifiedAt, verifiedBy, effective period, engine version, inputs, input hash).
10. Out of scope: IRCTC login/booking, CAPTCHA, browser automation, scraping, payment, seat availability, booking guarantees.
11. Scheduler, `pg-boss`, `booking_schedules`, notifications and reminders stay out of scope.
12. `journeys.tatkal_opens_at` (and `tatkal_rule_snapshot`) stay unused unless explicitly decided otherwise.
13. Premium Tatkal timing stays unresolved until official evidence establishes it.
14. Passenger name length (15 vs 16) is unresolved and is **not** a Phase 5 dependency.

Until a way to record conflicting evidence exists (decision G below), a rule with conflicting official evidence must simply not be entered as VERIFIED; the fail-closed gate then blocks it.

## 3. Not yet approved (do not implement)

| | Decision | Notes |
|---|---|---|
| A | Add rule key `tatkal.date_reference` (`ORIGIN_STATION` \| `BOARDING_STATION`) | Step 0 evidence supports ORIGIN_STATION (see §5); adding the key still needs approval |
| B | Origin-date derivation (schedule day offsets, storing the origin date, any user-entered fallback) | Proposed: store boarding date + derived origin date + how it was derived; derive from the boarding stop's day offset |
| C | Complete AC class list | Official sources conflict |
| D | Complete non-AC class list | Evidence incomplete |
| E | Premium Tatkal rule set | Partly evidenced |
| F | Rule key `tatkal.excluded_classes` | Official wording conflicting/ambiguous |
| G | A `CONFLICTING` rule verification status | Schema change |
| H | Timetable data provider, source and licence | Now architecture-critical (origin-station reference) |

Also open: grace period for rules due for re-verification (current approval implies fail closed); whether calculations are stored on explicit request or automatically.

## 4. Approved implementation order

| Step | Work | Gate |
|---|---|---|
| 0 | Official railway-rule verification | Every required fact VERIFIED / CONFLICTING / UNRESOLVED with evidence — **currently PARTIAL** |
| 1 | Lock decisions A–H | Written approval |
| 2 | Pure TatkalDateEngine + unit/property tests | Tests pass with test-only verified rules; not wired into the app |
| 3 | Additive database work (calculation records table; approved keys/status) | Migration reviewed; existing tests unchanged |
| 4 | Train schedule / day-offset representation (if B requires it) | No real timetable data invented |
| 5 | Application service + API | Ownership (404), blocked results against the shipped registry |
| 6 | Minimal UI + readiness item | No date shown without verified rules |
| 7 | Production enablement verification | Verified registry entries with evidence; never before Step 0 is complete |

Each step is its own reviewed PR.

## 5. Step 0 evidence status (2026-09-26)

**Evidence basis:** the product owner supplied *descriptions* of four official IRCTC sources obtained from `contents.irctc.co.in`. The documents themselves could not be read from the cloud environment (network policy blocked the IRCTC and Indian Railways domains). "VERIFIED" below therefore means the supplied description states the precise proposition; verbatim quotes and publication dates still need to be recorded before any registry change.

Sources (date checked 2026-09-26; publication dates not supplied):

| | Title | URL |
|---|---|---|
| A | Tatkal Booking (current page) | https://contents.irctc.co.in/en/TatkalBooking.html |
| B | Tatkal Booking — Frequently Asked Questions | https://contents.irctc.co.in/en/TatkalFaq.html |
| C | User Guide: Tatkal Booking (PDF, described as older than A) | https://contents.irctc.co.in/en/User%20Guide%20Tatkal%20Booking.pdf |
| D | Salient Features of Premium Tatkal (PT) Quota booking on Dynamic Pricing (PDF) | https://contents.irctc.co.in/en/Scilent%20feature%20of%20pt%20quota.pdf |

| Fact | Evidence position | Status |
|---|---|---|
| `tatkal.advance_days` | 1 day, excluding the day of journey (A, B, C) | VERIFIED (per supplied description) |
| Date reference | Train originating station (A, B, C; A has a worked example) | VERIFIED (per supplied description) |
| `tatkal.ac.opening_time` | 10:00 hrs (A, B, C) | VERIFIED (per supplied description); timezone not stated |
| `tatkal.non_ac.opening_time` | 11:00 hrs (A, B, C) | VERIFIED (per supplied description); timezone not stated |
| `tatkal.timezone` | No explicit statement in the supplied material | UNRESOLVED |
| AC class list | A: 1A/2A/3A/CC/EC/3E. B: 2A/3A/CC/EC/3E, and states Tatkal is allowed in all classes except "First AC and Executive". C: 1A/2A/3A/CC/EC/EA/3E | CONFLICTING (only 2A, 3A, 3E, CC appear in all three without an applicable exclusion) |
| Non-AC class list | C: SL/FC/2S. A's and B's non-AC lists were not supplied | UNRESOLVED |
| Excluded classes | B's "First AC and Executive" conflicts with A and C; "Executive" is ambiguous (EC? EA?) | CONFLICTING |
| Premium Tatkal ARP | Same as Tatkal (D) | VERIFIED (per supplied description) |
| Premium Tatkal relationship | "All rules for Tatkal quota booking over internet apply" (D) | VERIFIED (per supplied description) |
| Premium Tatkal non-AC opening | D: booking on opening day allowed on/after 10:00 hrs (no AC/non-AC split), while Tatkal non-AC opens 11:00 | CONFLICTING |
| Premium Tatkal classes / explicit date reference | Not stated beyond "all Tatkal rules apply" | UNRESOLVED |

Separate and **not** a Phase 5 dependency: passenger name length — A says 15 characters, C says 16. Unresolved; `passenger.name_max_length` stays MISSING.

**Gate result: PARTIAL.** Even if every VERIFIED value above were entered, the fail-closed engine would still block all results (timezone unresolved; every class unclassified or conflicting).

### Architecture consequence of the origin-station reference

The app's `journeyDate` is the date the train leaves the passenger's **boarding** station. Because the Tatkal window counts from the **originating** station, the engine needs, per train: the originating station, the boarding stop, and the boarding stop's **day offset** from origin departure (origin date = boarding date − day offset). Departure times are not needed for the calculation. Boarding at the origin station means offset 0. A journey with "any train" and no specific train cannot be resolved. The production train provider is currently `none`, so a licensed timetable source (decision H) is required before most real journeys can be calculated.

### Human decisions still required for Step 0

1. AC class list conflict (obtain a dated authoritative clarification, or explicitly approve using only the classes all sources agree on; unlisted classes then block).
2. Meaning and currency of "except First AC and Executive".
3. Timezone: an explicit official statement, or a recorded policy decision labelled as policy, not verified evidence.
4. Non-AC class lists from sources A and B.
5. Premium Tatkal non-AC opening time, class coverage and date reference.
6. Publication dates of sources A–D.
7. Verbatim quotes (with document/section) for every fact marked VERIFIED.
8. Timetable data source and licence (decision H).
9. Approval to add `tatkal.date_reference` (decision A).
