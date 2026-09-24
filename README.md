# TatkalFlow

**Be Ready When Tatkal Opens.**

A personal railway journey-planning and Tatkal preparation assistant. TatkalFlow
is an **independent third-party app, not affiliated with IRCTC or Indian
Railways**. It prepares everything ahead of time and reminds you. You complete
IRCTC sign-in, CAPTCHA, OTP and payment yourself on IRCTC. The app never
automates, bypasses or solves any of them.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Architecture audit | ✅ |
| 2 | Database & authentication | ✅ this README |
| 3+ | Passengers, stations, journeys, Tatkal engine, scheduler, notifications, web app… | planned |

## Repository layout

```
packages/shared     Zod schemas + types shared by API and web app (validation, rule keys, redaction)
apps/api            Fastify + Prisma API
  prisma/           schema.prisma, SQL migrations, seed
  scripts/          pglite-server.ts (local DB), new-migration.ts
  src/modules/      auth, otp, rules, audit, users, system
  test/             integration tests on in-memory PGlite
docs/               design notes (PGlite ↔ PostgreSQL compatibility)
```

## Getting started

Requires Node 22+.

```bash
npm install
cp .env.example apps/api/.env      # then fill the three secrets: openssl rand -base64 48
npm run build -w @tatkalflow/shared
npm run db:dev                     # terminal 1: local PGlite on 127.0.0.1:55432
npm run db:migrate && npm run db:seed
npm run dev:api                    # terminal 2: API on http://127.0.0.1:8787
```

With `OTP_PROVIDER=mock` and `MOCK_OTP_FIXED_CODE=123456`, sign in with any
Indian mobile number and code `123456`. No code is ever sent or logged.

```bash
npm test          # shared + API tests
npm run typecheck
npm run build
```

## Authentication

- **Mobile + OTP.** `POST /api/auth/otp/request` → `POST /api/auth/otp/verify`. The same flow registers and signs in, and the response is identical for new and existing numbers.
- **OTP storage:** only `HMAC-SHA256(OTP_HASH_PEPPER, sessionId:code)`, compared in constant time. Codes expire (5 min) and are single-use.
- **Limits:** 5 verify attempts per code, enforced atomically so parallel guesses can't exceed it. Resends are throttled to one per 30 s, with at most 3 sends per session, and a resend never resets the attempt count. Each mobile gets 5 requests per hour and each IP 20. After 3 locked codes, the mobile is locked out for 60 min. On top of that there are per-route IP limits. All values are configurable.
- **Sessions:** 15-minute JWT access token, kept in memory by the client. 30-day opaque refresh token in an `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` cookie, stored server-side as SHA-256. Refresh tokens rotate on every use, and **replaying a rotated token revokes the whole token family**. Every authenticated request checks that the session is still live, so logout takes effect immediately.
- **CSRF:** cookie-authenticated endpoints (`/refresh`, `/logout`) require the `X-TatkalFlow-CSRF: 1` header, plus an allow-listed `Origin` when one is sent. `SameSite=Strict` is a second layer.
- **OTP providers** implement `OTPProvider` and register with `registerOtpProvider(name, factory)`. `MockOTPProvider` is refused when `NODE_ENV=production`. MSG91/Twilio and India DLT registration are still to be chosen.

## IRCTC account

V1 stores **only the IRCTC User ID** (optional). There is no password column,
field, or API parameter. The API rejects a request that includes one, and a
test asserts that no table has a password or payment-secret column. Sign-in on
IRCTC is always manual.

## Railway rules

All regulatory values (Tatkal opening times, advance days, class groupings,
passenger limits, age thresholds) live in the `railway_rules` table and are read
through `RailwayRulesService`. Nothing is hardcoded in business logic.

Each rule has `rule_key`, `value` (typed, validated per key in
`packages/shared/src/schemas/rules.ts`), `source`, `effective_from`,
`effective_to`, `last_verified_at` and `status` (`DRAFT` / `ACTIVE` / `RETIRED`).

- The rule in force is the `ACTIVE` row whose `[effective_from, effective_to)` contains the instant being asked about. Overlapping `ACTIVE` periods are rejected.
- `supersede()` schedules a change from a future date, so journeys before that date keep the old rule.
- A missing rule causes a `503 RULE_NOT_CONFIGURED`. The app never falls back to a guess.
- Every change is audit-logged.

### Verifying railway rules

Seeded rules have `last_verified_at = NULL`. **Before launch, an operator must
check each value against the official IRCTC / Indian Railways source and set
`last_verified_at`.** The advance reservation period and senior-citizen
thresholds in particular have changed in recent years.

## Security

- **Nothing sensitive in logs.** No request/response bodies, OTPs, tokens, cookies or raw IPs. Request logs contain method, route pattern, status and request ID only. Pino redaction is a second layer.
- **Audit log** (`audit_logs`, append-only) records sign-in, OTP failures and lockouts, refresh-token reuse, logout, profile changes, IRCTC ID link/unlink and rule changes. Metadata passes through `redactSensitive()` first, mobile numbers are masked, and IPs are stored only as keyed hashes.
- **Headers and transport.** Helmet sets CSP `default-src 'none'`, HSTS, `nosniff` and `no-referrer`, and responses are `Cache-Control: no-store`. In production, plain-HTTP requests are rejected.
- **Validation.** Every input goes through the shared Zod schemas. Profile updates are `.strict()`, so a client can't set `role`.
- **Errors.** Users get a friendly message, a code and a request ID. Stack traces and internal details never leave the server.
- **Config checks.** At startup, the config validator refuses short or reused secrets, insecure cookies, or the mock OTP provider in production.

## Unresolved / next

- The HTTP rate limiter uses an in-memory store, which is fine for one instance. Multi-instance deployments need a shared store. OTP limits are already stored in the database.
- Refresh-token rotation is strict, so two tabs refreshing at once will sign one of them out. The web app must use a single shared refresh call.
- Data export and account deletion endpoints are planned for Phase 12.
- The OTP provider and DLT registration are not yet chosen.
