# TatkalFlow

**Be Ready When Tatkal Opens.**

A personal railway journey-planning and Tatkal preparation assistant. TatkalFlow
is an **independent third-party app, not affiliated with IRCTC or Indian
Railways**. It prepares everything ahead of time and reminds you. You complete
IRCTC sign-in, CAPTCHA, OTP and payment yourself on IRCTC. The app never
automates, bypasses or solves any of them, and it has no IRCTC booking API
integration: none is publicly available.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Architecture audit | ✅ |
| 2 | Database & authentication | ✅ |
| 3 | Passenger master, station master, app shell, onboarding | ✅ (station dataset source still to be decided) |
| 4+ | Journey preferences, Tatkal engine, scheduler, notifications, … | planned |

## Repository layout

```
packages/shared   Zod schemas, rule keys, station search, redaction,
                  and the cross-tab SessionManager (`@tatkalflow/shared/client`)
apps/api          Fastify + Prisma API
  prisma/         schema.prisma, SQL migrations, seed
  rules/          railway-rules.json: the source-controlled rules registry
  scripts/        pglite-server, new-migration, rules, import-stations
  src/modules/    auth, otp, rules, audit, users, passengers, stations, journeys, system
  test/           integration tests on in-memory PGlite (+ test-only fixtures)
apps/web          React + Vite PWA
docs/             PGlite compatibility, station master, dependency audit
```

## Getting started

Requires Node 22+.

```bash
npm install
cp .env.example apps/api/.env      # fill the three secrets: openssl rand -base64 48
npm run build -w @tatkalflow/shared
npm run db:dev                     # terminal 1: local PGlite on 127.0.0.1:55432
npm run db:migrate && npm run db:seed
npm run dev:api                    # terminal 2: API on :8787
npm run dev:web                    # terminal 3: app on http://localhost:5173 (proxies /api)
```

With `OTP_PROVIDER=mock` and `MOCK_OTP_FIXED_CODE=123456`, sign in with any
Indian mobile number and code `123456`. No code is ever sent or logged.

Station search stays empty until a station dataset is imported; see
[docs/station-master.md](docs/station-master.md).

```bash
npm test && npm run typecheck && npm run build
```

> **npm cache note:** on this development machine `~/.npm` contains root-owned
> files, so plain `npm install` fails with `EACCES`. Workaround used:
> `npm_config_cache=<writable dir> npm install`. The permanent fix
> (`sudo chown -R "$(id -u)":"$(id -g)" ~/.npm`) needs the owner's password
> and hasn't been run.

## Authentication & sessions

- **Mobile + OTP.** Codes are stored only as HMAC hashes, expire, and work once. Each code gets 5 attempts, enforced atomically. Resends are throttled and capped, there are per-mobile and per-IP hourly limits, and a mobile number is locked out after repeated failures. The OTP provider is pluggable (`OTPProvider`); the mock is refused in production.
- **Tokens.** A 15-minute JWT access token is held in memory only. A 30-day refresh token lives in an `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` cookie and is stored server-side as a hash. It rotates on every use, and replaying a rotated token revokes the whole token family.
- **Multiple tabs.** The web app's `SessionManager` makes all tabs take one Web Lock (`tatkalflow-auth`) before refreshing or logging out, so only one refresh happens per browser. The winner broadcasts the new access token over a `BroadcastChannel`; waiting tabs reuse it and don't refresh at all.
  - As a safety net for browsers without Web Locks, the server answers a same-device race with **409** (no tokens; the cookie is left alone), and the tab retries.
  - To count as a race, the replay must come within `REFRESH_RACE_GRACE_SECONDS` of the rotation, from the same IP hash and user agent, while the new session is still live. Every other replay is treated as theft.
- **CSRF.** Data routes need a bearer token, so a cookie alone grants nothing. The cookie endpoints (`/refresh`, `/logout`) require the `X-TatkalFlow-CSRF` header and an allow-listed `Origin`.

## Railway rules

Regulatory values live in **`apps/api/rules/railway-rules.json`**, which is reviewed in git. `npm run rules:sync -w @tatkalflow/api` applies it to the `railway_rules` table (the seed does the same).

- Each entry has `ruleKey`, `value`, `source`, `sourceUrl`, `effectiveFrom`, `effectiveTo`, `lastVerifiedAt`, `verifiedBy`, `verificationStatus` (`UNVERIFIED`, `VERIFIED`, `EXPIRED` or `SUPERSEDED`), `status` and `notes`.
- **"Exists" is not "verified."** `RailwayRulesService.getForBooking()` refuses critical rules that aren't `VERIFIED` whenever enforcement is on. Enforcement is always on in production and can't be disabled there. Setting `VERIFIED` requires an https `sourceUrl`, `lastVerifiedAt` and `verifiedBy`.
- **Values are immutable per `(ruleKey, effectiveFrom)`.** To change a rule, close the old entry's `effectiveTo` (and mark it `SUPERSEDED`), then add a new entry. Overlapping active periods are refused, verified rules whose period has ended become `EXPIRED`, and every change is audit-logged.
- **Current registry:** it holds only the values your brief supplied (AC 10:00, non-AC 11:00, 1 advance day, Asia/Kolkata, AC classes 2A/3A/3E), **all UNVERIFIED**. No passenger limits, advance-reservation period or age thresholds are included; those must come from a verified source. `npm run rules:status -w @tatkalflow/api` lists the gaps and exits non-zero while any exist, so it can gate a production deploy.

## Passenger & station master

- **Passengers:** name (any script), age, gender, berth and food preferences, and two opt-ins: senior-citizen benefits and a full berth for a child. Eligibility is decided at booking time by verified rules. **No identity-document fields.**
  - Every query is scoped to the signed-in owner. Another user's ID returns 404, exactly like an unknown ID.
  - Deletion is soft, so journey history keeps its details.
  - Audit entries record IDs and field names only.
- **Stations:** versioned dataset imports with provenance, a typo-tolerant search that needs no database extensions, and per-user favourites and recents. See [docs/station-master.md](docs/station-master.md).
- **Journeys (Phase 3 minimum):** `DRAFT` journeys with route, date and passengers, used by onboarding. The API returns honest warnings when the rules they depend on are missing or unverified.

## Web app (PWA)

React 19 + Vite + Tailwind 4 + TanStack Query + React Hook Form + Zod (the same schemas as the API).

- **Navigation.** Bottom navigation on phones and a side rail on tablet/desktop: Home, Trips, Passengers, Bookings, Profile. Signed-out users are redirected to the welcome screen, and a splash covers session restore.
- **States.** Every screen has loading skeletons, empty states and error states with retry.
- **Themes.** Light and dark, following the OS by default, with a manual override. Tokens are defined in `src/index.css`.
- **Onboarding.** Welcome → how it helps (including what stays in your hands on IRCTC and that tickets aren't guaranteed) → mobile → OTP → account ready → first passenger → first journey.
- **PWA.** Manifest, icons (including maskable and Apple touch), a service worker that caches the app shell only (API responses are never cached), install prompt and iOS instructions, and an offline banner. Offline data comes in Phase 11.
- **Accessibility.**
  - Labelled fields with inline errors (`role="alert"`) and touch targets of 44 px or more.
  - The station combobox follows the WAI-ARIA pattern, and dialogs use native `<dialog>`.
  - Skip link, visible focus ring, and support for reduced motion.
  - Status is never shown by colour alone.

## Security notes

- **Logs** contain no bodies, OTPs, tokens, cookies, names, mobile numbers or raw IPs. A test captures the real log output to check this.
- **Audit metadata** is redacted, and IPs are stored only as keyed hashes.
- **API responses** carry CSP `default-src 'none'`, HSTS, `nosniff` and `no-store`. Errors never expose internals.
- **The web app** renders no raw HTML and has no password inputs. Tokens are never put in web storage, and a source-policy test enforces all three.
- **Rate limiting:** the HTTP limiter sits behind `src/http/rate-limit.ts`. V1 is single-instance (in-memory); running several instances needs a shared store there. OTP limits are already stored in the database.
- **Dependency audit:** see [docs/security/dependency-audit.md](docs/security/dependency-audit.md).
