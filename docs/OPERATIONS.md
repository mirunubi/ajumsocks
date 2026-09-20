# Operations

Purpose: reopen this project on a new PC months later and run or deploy it. Commands below exist in this repository. Values of secrets are never recorded here.

---

## Repository

* GitHub: `https://github.com/mirunubi/ajumsocks`
* Branch: `main`
* Migration source of truth: `supabase/migrations/` (append-only; do not edit applied files)
* Database name: platform default `postgres` (local and hosted; do not rename)

App tables live in `public`. Privileged helpers live in `private`.

---

## Required Tools

Pinned in npm (root `package.json` / `app/package.json`):

* `supabase` CLI **^2.40.7** (devDependency; use via `npx supabase` / `npm run supabase`)
* `@supabase/supabase-js` **^2.57.4**
* App: Vite **^6**, React **^18**, TypeScript **^5.6**, Node not `engines`-pinned

Also required, versions **not** pinned in the repo:

* Git
* Node.js + npm (enough to run the packages above)
* Docker (Supabase CLI local stack)

Do not invent a Node version that is not in the repo.

---

## Clone / Install

```powershell
git clone https://github.com/mirunubi/ajumsocks.git
cd ajumsocks
npm install
npm --prefix app install
npx supabase start
```

Set local-only env (names only; never commit values):

* `LOCAL_DEV_PASSWORD` — 8+ characters, for `scripts/provision-local-users.mjs` and verify scripts

Then:

```powershell
node scripts/provision-local-users.mjs
node scripts/write-app-env.mjs
npm run build
```

Equivalent one-shot after start:

```powershell
npm run db:reset:local
```

(`supabase db reset` + provision local users + write `app/.env`)

Dev app:

```powershell
npm run dev
```

(`npm --prefix app run dev` — Vite `http://127.0.0.1:5173`)

There is no README in the repo; this file is the runbook.

---

## Local Supabase

`supabase/config.toml` `project_id = "ajumsocks"`.

| Service | Port | Notes |
| --- | --- | --- |
| API (`[api]`) | **54321** | `http://127.0.0.1:54321` |
| Postgres (`[db]`) | **54332** | **Not** CLI default 54322. Comment: 54322 already used on the original machine |
| Shadow DB | 54330 | `db diff` |
| Studio | 54323 | |
| Mailpit / local SMTP UI | 54324 | |
| Pooler | 54329 | `[db.pooler] enabled = false` |

Postgres major_version = **17**. `[db.seed] sql_paths = ["./seed.sql"]` — seed file does **not** insert Auth users.

`npx supabase status -o env` is how scripts read `API_URL`, `PUBLISHABLE_KEY`, `SECRET_KEY`.

---

## Environment Variables

**Names only.** Never put real values in Git.

### Browser / PWA (`app/.env`, gitignored)

* `VITE_SUPABASE_URL`
* `VITE_SUPABASE_PUBLISHABLE_KEY`

Written locally by `scripts/write-app-env.mjs` from `supabase status`.

### Edge runtime (injected by Supabase; also readable in Functions)

* `SUPABASE_URL`
* `SUPABASE_SECRET_KEY` (fallback names in code: `SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)

### Local scripts / hosted bootstrap

* `LOCAL_DEV_PASSWORD` — local Auth users + verify scripts
* `MASTER_BOOTSTRAP_PHONE`
* `MASTER_BOOTSTRAP_PASSWORD`
* `MASTER_BOOTSTRAP_DISPLAY_NAME` — optional, default `MASTER`
* `SUPABASE_URL` — optional override; else CLI status
* `SUPABASE_SECRET_KEY` — optional override; else CLI status

### Documented origin (`.env.example`, not used by Vite code)

* `PUBLIC_APP_ORIGIN` — production PWA origin note (`https://app.ajumsocks.co.kr`). Hosted Auth Site URL must match that deployment. Invite URLs use request `Origin` or that host as fallback in `user-admin`.

Never prefix Secret Key with `VITE_`.

---

## MASTER Bootstrap

Script: `scripts/provision-master.mjs`  
Check: `npm run verify:master` → `scripts/verify-master-bootstrap.mjs`

1. Set `MASTER_BOOTSTRAP_PHONE`, `MASTER_BOOTSTRAP_PASSWORD` (8+), optional `MASTER_BOOTSTRAP_DISPLAY_NAME`.
2. For hosted, also set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Locally, CLI status keys are used if unset.
3. Run `npm run provision:master`.
4. Idempotency: same phone MASTER already present → skip. Different MASTER phone → fail. Phone owned by non-MASTER → fail. Existing MASTER not ADMIN/active → fail (no auto-repair).
5. Confirm with `npm run verify:master` (needs the same phone/password env).
6. Change the bootstrap password after first login. Unset `MASTER_BOOTSTRAP_PASSWORD`. Do not commit phone/password.

MASTER is not created by SQL seed.

---

## Database Workflow

```text
new file under supabase/migrations/
  → npx supabase db reset   (or npm run db:reset / db:reset:local)
  → npm run verify:… / verify:e2e
  → npx supabase link --project-ref <PROJECT_REF>
  → npx supabase db push
```

* **Do not edit** a migration that already landed on `main` / hosted.
* Schema change = **new** timestamped migration.
* `npx supabase db push --dry-run` before hosted apply (Phase 1 plan).

CLI wrappers in `package.json`: `npm run supabase`, `npm run start:supabase`, `npm run db:reset`.

---

## Local Reset

```powershell
npx supabase db reset
```

Applies all files in `supabase/migrations/` then `supabase/seed.sql` (Auth users are **not** in seed).

After reset, recreate login users:

```powershell
node scripts/provision-local-users.mjs
node scripts/write-app-env.mjs
```

or `npm run db:reset:local`.

Local fixture phones used by provision/verify are **dev-only** (`provision-local-users.mjs`). They are not production MASTER credentials. Do not copy them into hosted env.

---

## Verification Commands

From root `package.json` (do not invent extra npm names):

| Script | Command |
| --- | --- |
| `npm run verify:master` | MASTER bootstrap check |
| `npm run verify:phase0` | Foundation / access |
| `npm run verify:phase1` | Users / invites |
| `npm run verify:phase2` | Events |
| `npm run verify:phase3` | Preparation |
| `npm run verify:phase4` | Products |
| `npm run verify:phase5` | Assortment |
| `npm run verify:phase6` | Inventory checks |
| `npm run verify:phase7` | Movements |
| `npm run verify:phase8` | Finance |
| `npm run verify:e2e` | Phase 8.5 end-to-end |
| `npm run verify:erd` | Live schema vs ERD/inventory docs |
| `npm run build` | `npm --prefix app run build` |
| `npm run provision:local` | Local Auth users |
| `npm run provision:master` | MASTER bootstrap |
| `npm run db:reset:local` | Reset + local users + `app/.env` |

Verify scripts need `LOCAL_DEV_PASSWORD` and a running local stack with provisioned users (except `verify:erd`, which uses Docker Postgres).

---

## Build

```powershell
npm run build
```

App: `tsc --noEmit && vite build` plus PWA `generateSW`. Output `app/dist/` (gitignored).

---

## Hosted Supabase Deployment

Repository does **not** store project ref or credentials. Operator must have Dashboard access.

Implemented CLI flow (MASTER PLAN / Phase 0):

1. `npx supabase login` (if needed)
2. `npx supabase link --project-ref <PROJECT_REF>`
3. Confirm hosted **Authentication → disable public signup** (do not assume local `enable_signup = false` copied itself)
4. `npx supabase db push` (migrations). Optional `--dry-run` first
5. Deploy Edge Functions in `supabase/functions/` (CLI `npx supabase functions deploy`; `config.toml` `[functions.*] verify_jwt` — `invite-accept` is `false`, others `true`)
6. Hosted Edge secrets: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (names the Functions code reads)
7. Hosted Auth Site URL / redirect: production PWA origin
8. PWA hosting `app/.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` only
9. `npm run provision:master` against hosted URL+Secret if MASTER does not exist yet

No GitHub Action in this repo automates the above.

---

## Git Workflow

```text
main
작업 → verify → commit → git push origin main
```

* No force push
* No commit of `.env`, Secret Key, bootstrap phone/password
* Do not rewrite published migrations

---

## Backup / Restore

**This repository does not automate backup or restore.**

Two assets are operationally distinct:

1. **PostgreSQL data** (schema via `supabase/migrations/`; **data** is not in Git except `seed.sql`, which has no Auth users)
2. **Storage objects** in buckets `event-photos`, `product-images`, `expense-receipts` (bytes are not in Git; Postgres holds metadata only)

Hosted Supabase PITR / Dashboard backups are **outside this repo**. Do not assume they are configured. Schema can be rebuilt with `db push`; event photos/receipts/product images cannot be rebuilt from Git.

---

## Disaster / New-PC Recovery

1. Clone `https://github.com/mirunubi/ajumsocks` (`main`)
2. Recover env: publishable key, Secret Key, `LOCAL_DEV_PASSWORD` / MASTER bootstrap vars from a password manager — not from Git
3. Confirm access to the hosted Supabase project
4. Local: Docker + `npx supabase start` + `db reset` + `provision-local-users` + `write-app-env` (DB port **54332**)
5. `npm run build` and the verify scripts you need
6. Hosted: `db push` status / migration history; signup still off; Functions deployed
7. Storage: buckets exist; objects only if the hosted project still has them (not guaranteed by Git)

---

## Housekeeping

`events` catalog comment still says “P&L is a later phase” while finance tables exist. Future schema housekeeping only — no migration edit in this documentation change.
