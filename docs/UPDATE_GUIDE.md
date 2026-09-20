# Update Guide

How to change this repo without breaking the current Domain boundaries.

Baseline: commit `84e22cc`, Phase 0–8 and E2E passing, Phase 9 not started. CatchMenu-scale governance is out of scope. Prefer updating existing stable docs over adding a new plan file for every feature.

---

## Change procedure

```text
1. 요구사항 확인
2. 관련 Domain 확인
3. ARCHITECTURE 확인
4. ERD / SCHEMA_INVENTORY 확인
5. DATA_DICTIONARY 확인
6. SECURITY 영향 확인
7. 관련 migration / Edge / UI 조사
8. Impact Scope 작성
9. 새 migration 작성
10. 구현
11. Domain verify
12. E2E 필요성 판단
13. ERD/Data Dictionary 갱신
14. Commit / Push
```

Do not skip 3–6 because the UI looks small. Do not start a new Phase folder of docs for a one-screen fix.

---

## Existing migrations are immutable

Files already on `main` under `supabase/migrations/` are not edited.

Schema change = **new migration** with a later timestamp.

Uncommitted work-in-progress on a branch may be an exception while it is still local. The operating rule after merge is: applied migrations stay as history.

---

## Domain impact map

Touch the listed objects (and their Edge functions) when that Domain changes. Scripts exist in root `package.json`.

### Auth / User

Check: `auth.users`, `profiles`, `invites`, `private` RLS helpers, MASTER bootstrap (`provision:master` / `verify:master`).

Domain verify: `npm run verify:phase0`, `npm run verify:phase1`.

### Event

Check: `events`, `event_members`, `event_contacts`, `event_photos`, `event_organizers` / terms / contacts. Contract amount columns are ADMIN-only (see `docs/DECISIONS.md` D-014, `docs/SECURITY.md`).

Domain verify: `npm run verify:phase2`, `npm run verify:organizers`.

### Preparation

Check: preparation master/template (`preparation_items`, `preparation_sets`, `preparation_set_items`) and Event Snapshot (`event_preparation_plans`, `event_preparation_items`).

Domain verify: `npm run verify:phase3`.

### Product

Check: `products`, `product_variants`, category/size/color, attributes, tags, images.

Domain verify: `npm run verify:phase4`.

### Assortment

Check: template rules, Event Snapshot, and that Inventory Check targets come from Event assortment items. No quantity on assortment.

Domain verify: `npm run verify:phase5`.

### Inventory

Check: checks, `event_inventory_current`, `inventory_positions`, movement, adjustment. Keep Physical / Position / History distinct (below).

Domain verify: `npm run verify:phase6` (checks), `npm run verify:phase7` (movements).

### Finance

Check: daily sales, expenses, receipts, `event_financial_inputs`, `audit_logs`, contract-sensitive event columns. No FK to inventory.

Domain verify: `npm run verify:phase8`.

---

## After schema change — which docs?

| Question | Update |
| --- | --- |
| Table / FK / relationship changed? | `docs/SCHEMA_INVENTORY.md`, `docs/ERD.md` |
| Column or table **meaning** changed? | `docs/DATA_DICTIONARY.md` |
| New Edge / Storage / Auth flow? | `docs/ARCHITECTURE.md` |
| Role / RLS / sensitive-data boundary? | `docs/SECURITY.md` |
| env / script / deploy steps? | `docs/OPERATIONS.md` |
| Important design choice that replaces an old one? | append `docs/DECISIONS.md` |

Run:

```powershell
npm run verify:erd
```

Do not commit a schema change if `verify:erd` FAILs. Fix the docs or the migration first.

---

## Test policy

Not every change runs every Phase script.

Minimum for any code change:

* the Domain verify(s) from the map above
* `npm run build`

Also run `npm run verify:e2e` when any of these is true:

* two or more Domains connected in one change
* Auth / RLS change
* Inventory Position or Movement change
* Finance summary change
* Event lifecycle change

`verify:erd` is required after schema or ERD/inventory doc edits. It talks to local Docker Postgres; it does not replace Phase verifies.

---

## Security change

Auth, RLS, or finance/contract sensitive fields: hiding a field in the UI is not done.

Confirm the boundary in:

* PostgreSQL GRANT / RLS (row vs column)
* Edge / API response
* a direct API or PostgREST call as STAFF/PART_TIMER, not only the ADMIN screen

Do not put Secret Key / service_role in the browser or Vite env. `AdminGuard` is not the security boundary.

---

## Inventory change

Always keep three meanings separate:

* Physical Check (`event_inventory_checks` / items, then `event_inventory_current`)
* Operational Position (`inventory_positions`)
* Movement / Adjustment history

Do not merge them into one “stock” number. Do not rewrite CONFIRMED history so it matches the live Position. If expected stock is wrong, add a new Check or an Adjustment.

Positions cannot go negative. Do not edit an old DISPATCHED movement to make the math work.

---

## Snapshot change

Preparation / Assortment: Template and Event Snapshot are different rows.

An implementation that **automatically** updates existing Event Snapshots when a Template changes needs a new explicit Decision. Default is copy-on-apply only (`docs/DECISIONS.md` D-003).

---

## Finance change

Do not auto-link:

* sales amount
* product cost
* expenses
* contract
* profit

to Inventory Check, Position, or Movement.

There is no accurate per-SKU sales quantity source yet. Do not invent COGS from approximate packs.

Contract amounts (`commission_rate`, `fixed_fee`) stay off authenticated PostgREST SELECT. ADMIN reads them through Edge.

---

## Git

Default branch: `main`.

```text
작업
→ 검증
→ git diff
→ secret scan
→ commit
→ push
```

No force push. Do not commit secrets, `.env` values, or build artifacts (`app/dist`, `node_modules`).

---

## Do not grow docs for every feature

Prefer updating ARCHITECTURE, ERD, dictionary, SECURITY, OPERATIONS, DECISIONS.

Add a **new** standalone doc only when:

* a large new Domain lands
* a migration is unusually complex
* a design review needs a dedicated write-up
* operations need a separate runbook

Phase plan files already in `docs/` are historical. New work does not require a new `NN_PHASEx_...` file by default.
