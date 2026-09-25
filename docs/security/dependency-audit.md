# Dependency audit

Last reviewed: 2026-09-25 (`npm audit --omit=dev` at the repo root).

| Package | Installed | Severity | Advisory | Pulled in by | Production runtime? |
|---|---|---|---|---|---|
| `deepmerge-ts` | 7.1.5 (fixed in ≥ 8.0.0) | High | [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx): stack exhaustion when merging recursive object graphs | `prisma@7.10.0` → `@prisma/config` | **No** |
| `mysql2` | 3.15.3 | High | [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr) (auth-plugin downgrade leaks cleartext password), [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3) (zlib decompression bomb) | `prisma@7.10.0` | **No** |

`npm audit` counts 4 high findings: the two packages above plus `@prisma/config` and `prisma`, which are flagged only because they depend on them.

## Why these don't affect the running API

- Both packages are reached only through the **`prisma` CLI**, a `devDependency` of `apps/api` used for `prisma generate` and `prisma migrate`.
- The API at runtime uses `@prisma/client` + `@prisma/adapter-pg` + `pg`. `@prisma/client` lists `prisma` only as an *optional peer*. Checked on 2026-09-25: nothing under `node_modules/@prisma/client`, `node_modules/@prisma/adapter-pg`, or the compiled `apps/api/dist` imports `deepmerge-ts` or `mysql2`.
- `mysql2`'s issues need a connection to a (malicious) MySQL server. TatkalFlow only talks to PostgreSQL.
- `deepmerge-ts` runs on Prisma's own config file, which is trusted and in the repo.

**Residual risk:** developer and CI machines that run the Prisma CLI. That is low: the inputs are trusted, and no MySQL connection is ever made.

## Decision

- **Do not downgrade Prisma** (npm's suggested "fix" is `prisma@6.19.3`, a major-version downgrade). It would drop the driver-adapter setup this project depends on, just to silence a dev-time finding.
- Production images install with `npm ci --omit=dev`, so the Prisma CLI and these packages aren't present at runtime. Migrations run from a separate build/CI step.
- Re-check on each Prisma release. Upgrade once a stable Prisma version depends on `deepmerge-ts ≥ 8` and a patched `mysql2`.
