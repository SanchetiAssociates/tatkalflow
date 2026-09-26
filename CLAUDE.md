# TatkalFlow — guide for Claude Code

## Project

TatkalFlow ("Be Ready When Tatkal Opens") is a personal railway journey-planning and Tatkal preparation assistant for Indian Railways travel. It prepares passengers, journeys and preferences ahead of time. It is an **independent app, not affiliated with IRCTC or Indian Railways**. The user completes IRCTC sign-in, CAPTCHA, OTP and payment themselves on IRCTC; TatkalFlow never automates, bypasses or solves any of them and has no IRCTC booking integration.

The product owner is a practising Chartered Accountant (Sancheti Associates). GitHub (`SanchetiAssociates/tatkalflow`) is the source of truth.

## Architecture

npm workspaces monorepo, Node 22+.

| Path | What |
|---|---|
| `packages/shared` | Zod schemas, rule keys and value schemas, journey config, pure `computeReadiness()`, rule snapshots, station search, log redaction, client `SessionManager` (`@tatkalflow/shared/client`), `TatkalDateEngine` **type contract only** |
| `apps/api` | Fastify 5 + Prisma 7 (PostgreSQL; PGlite for dev/tests). Modules: auth, otp, rules, audit, users, passengers, stations, journeys, trains, system |
| `apps/api/rules/railway-rules.json` | Source-controlled railway-rule registry, applied by `rules:sync` / the seed |
| `apps/api/prisma` | Schema, additive SQL migrations, seed |
| `apps/web` | React 19 + Vite PWA, Tailwind 4, TanStack Query, React Hook Form |
| `docs/` | Phase specs and notes, station master, PGlite notes, dependency audit |

Key design points:
- Every API query is scoped to the authenticated user; another user's IDs (and malformed IDs) return 404.
- `RailwayRulesService` separates "exists" from "verified". `getForBooking` refuses unverified critical rules when enforcement is on (always in production).
- Journeys copy template configuration at creation; each journey stores a rule snapshot.
- Web: `apps/web/src/lib/session-cache.ts` clears all private React Query data whenever the signed-in identity changes (deny by default; only listed shared keys survive), and `AuthProvider` re-mounts the app on identity change. New private queries are covered automatically — don't add keys to the shared list unless the data is truly the same for every user.
- Train data comes from a `TrainDataProvider`: `mock` (fictional "Sample" trains, 90101–90108) in dev/test, refused in production where the default is `none`.

## Status

| Phase | State |
|---|---|
| 1–3 | Complete (architecture, database & auth, passengers, stations, app shell, onboarding) |
| 4 | Complete — journey templates, journeys, ordered train/class preferences, readiness, rule snapshots (PR #1) |
| F1 fix | Complete — per-user React Query cache isolation (PR #2) and regression coverage (PR #3) |
| **5** | **Preparation only.** Spec and architecture approved; Step 0 official rule verification **PARTIAL**. **No Phase 5 code exists.** See `docs/phase-5-preparation.md` |

Continuation state and the next task: `CLAUDE_HANDOFF.md`.

## Commands

```bash
npm ci
npm run build -w @tatkalflow/shared                 # needed before typecheck/tests of api/web
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable \
  npm run db:generate -w @tatkalflow/api            # Prisma client; reads DATABASE_URL but doesn't connect
npm test                                            # all workspaces; tests use in-memory PGlite, no DB server needed
npm run typecheck
npm run build                                       # also runs prisma generate: needs DATABASE_URL
npm run rules:status -w @tatkalflow/api             # lists unverified/missing critical rules; non-zero exit while gaps exist
```

There is no lint step in this project. Local dev stack: see README "Getting started" (`db:dev`, `db:migrate`, `db:seed`, `dev:api`, `dev:web`; secrets in `apps/api/.env`).

Baseline at handoff: 265/265 tests (shared 73, api 150, web 42), typecheck and build pass.

## Railway / Tatkal facts — non-negotiable rules

- **Never invent or assume railway rules, dates, times, class lists, station data, train data or operational facts.** Not from general knowledge, not from third-party sites.
- Only official IRCTC / Indian Railways sources count as evidence. Record the exact https URL, title, section, publication date if shown, date checked, and the relevant wording.
- A rule becomes VERIFIED in the registry only with `sourceUrl` (https), `lastVerifiedAt` and `verifiedBy`, and only when the source supports the exact proposition. Conflicting official sources are reported, never silently resolved.
- UNVERIFIED or MISSING rules must surface as warnings / blocked states in the product, never as facts.
- Rule values are immutable per `(ruleKey, effectiveFrom)`; change a value by closing the old entry and adding a new one.
- Registry test expectations in `apps/api/test/rules.test.ts` pin the registry contents; changing the registry is a deliberate, reviewed change.
- Known unresolved conflict: passenger name length — current IRCTC Tatkal page says 15 characters, the IRCTC User Guide PDF says 16. `passenger.name_max_length` stays MISSING until the product owner decides.
- The station master has no production dataset; `apps/api/test/fixtures/stations.test-only.csv` is test-only. Mock trains are fictional.

## Product constraints

- No IRCTC login/booking integration, CAPTCHA handling, scraping, anti-bot circumvention, browser automation or payment automation.
- Never store IRCTC passwords, payment OTPs, UPI PINs or CVV/card data (tests enforce the absence of such columns and inputs).
- Never claim seat availability or guarantee a booking (`apps/web/src/test/source-policy.test.ts` bans such wording).
- Logs and audit entries carry no personal data, OTPs, tokens or bodies.
- Database changes are additive migrations; never rewrite or delete existing migrations.
- Scheduler (`pg-boss`, `booking_schedules`), notifications and reminders are not active and are out of scope until explicitly specified.

## Git workflow

- Work on a feature branch from `main`; open a PR; the product owner approves merges. Don't commit directly to `main`.
- Merge with a regular merge commit (no squash, no rebase). Never force-push, rewrite history or delete branches.
- Before pushing: run tests, typecheck and build; review the diff; keep the change to what was asked.
- Don't modify existing tests merely to make them pass; if behaviour intentionally changes, explain why in the commit.
- Conventional commit subjects (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Next task

See `CLAUDE_HANDOFF.md` §14. In short: finish Phase 5 Step 0 (official evidence) with the product owner before any Phase 5 code.
