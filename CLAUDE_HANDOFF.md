# TatkalFlow — Claude Code Handoff

## 1. Handoff Date
2026-09-26

## 2. Repository
`SanchetiAssociates/tatkalflow` — remote `origin` = https://github.com/SanchetiAssociates/tatkalflow

## 3. Branch
- `main` is the integrated baseline (PRs #1–#3 merged).
- This handoff (docs only) is committed on `claude/optimistic-lovelace-cdc7fv`, fast-forwarded from `main`, so `main` is not modified directly (project rule). Merge it into `main` through a PR, or continue from this branch; either way the application code is identical to `main` at `c78bf5d`.
- Other retained branches (already merged, keep): `fix/session-cache-isolation`, `test/session-cache-regressions`.

## 4. HEAD Commit
- Application baseline: `c78bf5d46446df5d27c598d8532931f1217bb458` — "Merge pull request #3: cover session identity cache invariants" (`main`).
- Handoff commit: the commit that adds this file on top of `c78bf5d` ("chore: prepare TatkalFlow cloud-to-local handoff"); see `git log -1`.

## 5. Working Tree Status
Clean at `c78bf5d` before the handoff (verified with `git status`). The only on-disk extras were gitignored build outputs (`*/dist`, `apps/api/src/generated`). The handoff adds only `CLAUDE.md`, `CLAUDE_HANDOFF.md` and `docs/phase-5-preparation.md`.

## 6. Project Objective
A personal railway journey-planning and Tatkal preparation assistant: save passengers, stations, journey templates and dated journeys with ordered train/class preferences, check booking readiness against verified railway rules, and (Phase 5) calculate when Tatkal booking opens. Booking itself always happens on IRCTC by the user. Independent app; no IRCTC integration or automation.

## 7. Completed Work
- **Phases 1–3:** architecture; database & mobile-OTP auth (hashed OTPs, rotating refresh tokens, CSRF, rate limits, audit log, log redaction); passenger master; station master importer with provenance (no production dataset); PWA shell and onboarding.
- **Phase 4 (PR #1, merge `494258f`):** journey templates vs dated journeys (copy-on-create); ordered preferred trains and class preferences (default 2A → 3A → 3E); per-passenger berth; RAC/waitlist and auto-upgrade preferences; rule-driven passenger limit, name length and senior-concession handling; rule snapshots; booking-readiness preview; `TrainDataProvider` with a fictional mock; additive migration `20260925112920_phase4_journey_templates`.
- **Registry follow-up (`f804f44`):** owner-verified rules `tatkal.max_passengers_per_pnr = 4` and `tatkal.senior_citizen_concession_available = false` (source https://contents.irctc.co.in/en/TatkalBooking.html, verified 2026-09-25 by Sancheti Associates).
- **F1 security fix (PR #2, merge `d58950a`):** React Query cache isolated per signed-in identity (`apps/web/src/lib/session-cache.ts`, wired in `AuthProvider`).
- **F1 regression coverage (PR #3, merge `c78bf5d`):** A → B → A and same-user token-refresh invariants.
- **Phase 4 post-merge audit:** READY FOR PHASE 5 (findings listed in §12).

## 8. Current Phase
**Phase 5 — Tatkal Date Engine: preparation. Step 0 (official railway-rule verification) is PARTIAL.** No Phase 5 code has been written.

## 9. Work Completed in Current Phase
- Phase 5 specification produced and its architecture direction approved (14 locked decisions) — recorded in `docs/phase-5-preparation.md` §2.
- Pending architecture decisions A–H and the approved implementation order (Steps 0–7) — same file §3–4.
- Step 0 analysis of four official IRCTC sources as described by the product owner — same file §5. Supported (per supplied descriptions): advance period 1 day excluding the journey date; reference = train originating station; AC 10:00; non-AC 11:00; Premium Tatkal ARP same as Tatkal. Unresolved/conflicting: timezone, AC class list, non-AC class list, excluded classes, Premium Tatkal non-AC opening time and classes.
- Registry, code, schema and tests are unchanged by Phase 5 work.

## 10. Work Remaining
1. Finish Step 0 (human-dependent): verbatim quotes and publication dates for sources A–D; resolve the AC class-list conflict; clarify "except First AC and Executive"; obtain the non-AC class lists; establish the timezone (official statement or a recorded policy decision labelled as policy); Premium Tatkal non-AC timing and classes.
2. Step 1: lock decisions A–H (`tatkal.date_reference`, origin-date derivation, class lists, Premium Tatkal rules, excluded classes, CONFLICTING status, timetable source/licence).
3. Steps 2–7: pure engine + tests → additive schema → schedule day offsets → service/API → minimal UI + readiness → production enablement (see `docs/phase-5-preparation.md` §4).
4. Outside Phase 5: production station dataset (source/licence undecided); passenger-name-length decision (15 vs 16).

## 11. Tests and Verification
Run on 2026-09-26 at `c78bf5d` from a clean rebuild (Node 22.22.2, npm 10.9.7):

| Check | Command | Result |
|---|---|---|
| Tests | `npm test` | **265/265 pass** — shared 73, api 150, web 42 |
| Typecheck | `npm run typecheck` | Pass |
| Production build | `npm run build` (with `DATABASE_URL` set) | Pass (PWA precache 58 entries) |
| Lint | — | Not part of this project's workflow |

Setup before checks: `npm ci`, `npm run build -w @tatkalflow/shared`, `DATABASE_URL=... npm run db:generate -w @tatkalflow/api` (see `CLAUDE.md`).

## 12. Known Issues
- **Rules:** all six Phase 5-critical rules are UNVERIFIED or MISSING in the registry (`npm run rules:status -w @tatkalflow/api` exits non-zero by design).
- **Station data:** no production station dataset; journeys can't be created in a fresh environment until one is imported (test fixture is test-only).
- **Train data:** production provider is `none`; no licensed timetable source.
- **Passenger name length:** 15 (current Tatkal page) vs 16 (User Guide PDF) — unresolved; rule MISSING.
- **Audit F2 (low):** list edits (add/remove passenger/train/class) read-then-replace without a row lock; simultaneous edits to the same journey by the same user can overwrite each other.
- **Audit F5 (informational):** deleting a journey doesn't check its state (only DRAFT exists today).
- **Audit F8 (low, test debt):** `apps/api/test/config-and-logging.test.ts` › "removes secrets from anything logged" failed once intermittently (probable cause: the log's `pid` can contain the checked string "4321"); not reproduced since. Left untouched.
- **Docs:** README line "Journeys (Phase 3 minimum)" is historical wording.
- **Dependencies:** `npm audit` reports 4 high findings in the Prisma CLI chain (dev-time only; documented in `docs/security/dependency-audit.md`). `pg-boss` is a declared but unused dependency.
- **Setup:** `prisma generate` / `npm run build` require `DATABASE_URL` to be set even though no database is contacted.

## 13. Important Constraints
- **Official sources only** for railway/Tatkal facts (IRCTC / Indian Railways). Record URL, title, section, publication date, date checked and wording. No third-party sources, no general knowledge.
- **No invented railway rules, dates, times, class lists, station or train data.**
- **UNVERIFIED/MISSING data** must surface as warnings or blocked states; the Phase 5 engine must fail closed unless every required rule is VERIFIED with evidence. Conflicts are reported, never silently resolved.
- **Architecture:** follow the approved Phase 5 decisions in `docs/phase-5-preparation.md`; decisions A–H are not approved; do not implement ahead of the gate order.
- **Security/data integrity:** user-scoped queries (404 for others' data); per-user client cache isolation; no IRCTC passwords, payment OTPs, UPI PINs or card data; no personal data in logs/audit; additive migrations only; don't weaken auth, CSRF or rate limits.
- **Product boundaries:** no IRCTC login/booking, CAPTCHA, scraping, browser automation, payment automation, seat-availability or booking-guarantee claims; no scheduler/notifications until specified.

## 14. Next Recommended Action
With the product owner, complete the Phase 5 **Step 0 evidence record** in `docs/phase-5-preparation.md` §5: enter the verbatim quotes, section references and publication dates they supply for sources A–D, and record their decisions on the AC/non-AC class lists, timezone and Premium Tatkal. Change nothing else, and ask the product owner to declare the Step 0 gate complete before any Step 1 or code work.

## 15. Do Not Do
- Don't start Phase 5 implementation (engine, schema, API, UI) before Step 0 is declared complete and Step 1 decisions are approved.
- Don't change the railway-rule registry or mark anything VERIFIED without official evidence and owner approval.
- Don't resolve the 15-vs-16 name-length conflict or the class-list conflict yourself.
- Don't use third-party sites or general knowledge as railway evidence; don't route around network restrictions.
- Don't add IRCTC integration, scraping, CAPTCHA handling, browser/payment automation, a scheduler or notifications.
- Don't commit to `main` directly, force-push, rewrite history, delete branches, or squash merges.
- Don't modify existing tests just to make them pass, or "fix" unrelated issues without being asked.
- Don't import the test station fixture into a real database.

## 16. Cloud-to-Local Continuation
This project is intentionally being continued in **local Claude Code** from this handoff. The Claude Code cloud session should not be used for ordinary continuation work. Start the local session by reading `CLAUDE.md`, this file and `docs/phase-5-preparation.md`, then verify the baseline (`git status`, `npm ci`, the setup steps in `CLAUDE.md`, `npm test`, `npm run typecheck`, `npm run build`).
