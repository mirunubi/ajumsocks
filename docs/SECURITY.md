# Security

Source: live PostgreSQL (`private` / `public` functions and policies), `supabase/migrations/`, `supabase/config.toml`, Edge Functions, `app/`.

This describes **current implementation**. No real phone numbers, passwords, or Secret values.

---

## Authentication

### Public signup

`supabase/config.toml`:

* `[auth] enable_signup = false`
* `[auth.sms] enable_signup = false`
* `[auth.email] enable_signup = true` — internal Auth email identity only. Public signup remains off via `[auth] enable_signup = false`

Verify scripts call `auth.signUp` with the publishable key and expect an error. There is no Sign Up screen.

Hosted Dashboard signup must be confirmed separately. Local `enable_signup = false` does not prove hosted is off (`docs/00_MASTER_PLAN.md`).

### Phone / password UX

Login (`/login`): telephone field + password. Client `signInWithPassword` uses a synthetic email, not SMS OTP.

Invite (`/invite/:token`): masked name/phone preview, then the invitee sets a password (≥ 8). Config `minimum_password_length = 8`.

### Internal synthetic identity

Phone is normalized to E.164 (`+82…`). Auth email is:

```text
{digits}@users.local.ajumsocks
```

(`scripts/phone.mjs`, `app/src/lib/phone.ts`). Auth stores that email. The app stores E.164 on `profiles.phone`.

### `profiles` and `auth.users`

`profiles.id` = `auth.users.id` (PK + FK, ON DELETE CASCADE). An Auth session without a readable, in-window profile does not grant app access (`evaluateAccess` + `private.has_app_access()`).

### Invite flow

1. ADMIN `user-admin` `create`: Auth user with a random password, `profiles.is_active = false`, `is_master = false`, invite row with `token_hash` only (TTL 7 days).
2. Raw token is returned once in `invite_url`. Never stored.
3. `invite-accept` (`verify_jwt = false`): `preview` / `accept` by token hash.
4. `accept`: Auth Admin sets password, sets `invites.used_at`, sets `profiles.is_active = true` (and `is_master = false` in the UPDATE filter).
5. Client signs in with the new password.

Reuse, revoke, and expiry are rejected. One active invite per profile (partial unique).

### Password set / change

* Invitee: `invite-accept` `accept` → `auth.admin.updateUserById` password.
* There is no in-app “change my password” screen in `app/src`.
* Local/hosted MASTER bootstrap sets the Auth password via Admin API (`scripts/provision-master.mjs`). Script tells the operator to change it after first login and unset the env var.

---

## Roles

Enum `public.app_role`: **ADMIN**, **STAFF**, **PART_TIMER**. There is no `MASTER` enum value.

MASTER is **`role = ADMIN` AND `is_master = true`**. CHECK: MASTER implies ADMIN. Partial unique: at most one `is_master` row.

Event assignment uses a different enum `event_assignment_role` (MANAGER, STAFF, PART_TIMER) on `event_members`. It does not replace `profiles.role`.

---

## MASTER Protection

Trigger `private.protect_master_profile` (SECURITY DEFINER, BEFORE UPDATE OR DELETE on `profiles`):

| Action | When `auth.role()` is not `service_role` | `service_role` (Secret Key client) |
| --- | --- | --- |
| DELETE MASTER row | Exception: 삭제 불가 | Trigger allows |
| `is_master` change | Exception: 서버에서만 가능 | Trigger allows |
| MASTER `role` or `is_active` change | Exception: 강등/비활성 불가 | Trigger allows |

Authenticated clients have **SELECT only** on `profiles` (no UPDATE/DELETE policy). So the trigger is a second line if a privileged connection is used.

Application layer (`user-admin` `update`): if target `is_master`, HTTP 403 `master_protected` before any patch. Create always `is_master = false`.

`scripts/provision-master.mjs` is the implemented path that sets `is_master = true` (Secret Key). Idempotent: same phone skip; different MASTER phone refuse; existing non-MASTER phone refuse.

`invite-accept` will not flip `is_active` on a MASTER row (`eq("is_master", false)`).

---

## Login Access Window

| Column | Meaning |
| --- | --- |
| `is_active` | false → no app access |
| `login_allowed_from` | NULL = no start bound; otherwise access only if `now >= from` |
| `login_allowed_until` | NULL = no end bound; otherwise access only if `now <= until` |

Enforced in:

1. Client `evaluateAccess` — login UI signs out and shows denial; `AuthedGuard` / `AdminGuard` block routes
2. Edge `hasAppAccess` — 403 on Functions
3. RLS `private.has_app_access()` / `private.is_admin_user()` — SELECT of business rows fails even if a JWT still exists

Auth JWT expiry (`jwt_expiry = 3600`) is separate. A still-valid JWT with an expired profile window cannot read RLS-protected tables.

`private.is_master_user()` checks `is_master` and `is_active` only (no login window in that function). It is not granted to `authenticated` (see helpers).

---

## RLS Helpers

Live `private` functions (24). Names below are from `pg_catalog`. `public.has_app_access` etc. were dropped in `20260919130000_private_security.sql`.

### Access helpers (used by policies / Edge-equivalent checks)

| Function | SECURITY DEFINER | `search_path` | EXECUTE | Purpose |
| --- | --- | --- | --- | --- |
| `private.has_app_access()` | yes | `''` | authenticated | Active profile inside login window |
| `private.is_admin_user()` | yes | `''` | authenticated | ADMIN + same window as access |
| `private.current_app_role()` | yes | `''` | owner only (not authenticated) | Returns `profiles.role` for `auth.uid()` |
| `private.is_master_user()` | yes | `''` | owner only (not authenticated) | Active MASTER flag |
| `private.can_read_event(uuid)` | yes | `''` | authenticated | Access + (ADMIN or `event_members` row) |
| `private.can_write_event(uuid)` | yes | `''` | authenticated | `is_admin_user()` only |
| `private.can_read_location(uuid)` | yes | `''` | authenticated | ADMIN, or EVENT location of a readable event |
| `private.can_read_movement(uuid)` | yes | `''` | authenticated | ADMIN, or source/dest EVENT location readable |
| `private.can_read_setup_session(uuid)` | yes | `''` | authenticated | Session whose event is `can_read_event` |
| `private.can_read_transition_leg(uuid)` | yes | `''` | authenticated | ADMIN, or from/to event readable |
| `private.storage_event_id(text)` | no | `''` | authenticated | First path folder as event UUID |
| `private.storage_product_id(text)` | no | `''` | authenticated | First path folder as product UUID |

### Other `private` functions (not RLS predicates)

| Function | Role |
| --- | --- |
| `private.protect_master_profile()` | MASTER row guard trigger |
| `private.set_updated_at()` | `updated_at` trigger |
| `private.ensure_event_location()` | Create/update EVENT `inventory_locations` with events |
| `private.write_audit()` | Insert `audit_logs` (called from finance RPCs) |
| `private.event_business_range()` | KST date range for an event |
| `private.remainder_midpoint()` | Remainder band → integer midpoint |
| `private.guard_confirmed_inventory_check()` | CONFIRMED check header immutable |
| `private.guard_confirmed_inventory_check_items()` | CONFIRMED check items immutable |
| `private.guard_inventory_movement_header()` | Movement delete/status guard |
| `private.guard_inventory_movement_items()` | Movement item mutability by status |
| `private.protect_setup_raw_timestamps()` | Setup session raw arrival/completed immutable |
| `private.protect_setup_photos_immutable()` | Setup photo row UPDATE forbidden |

Do not call dropped `public.*` helper names. Policies use `private.*`.

---

## SECURITY DEFINER

Pattern after Phase 0 complement:

* Privileged helpers live in schema `private` (`USAGE` to `authenticated` and `service_role`; not to `anon`/`public`)
* `SET search_path = ''`
* Schema-qualified `public.profiles` / `pg_catalog.now()` inside helpers

### `authenticated` EXECUTE

`has_app_access`, `is_admin_user`, `can_read_event`, `can_write_event`, `can_read_location`, `can_read_movement`, `can_read_setup_session`, `can_read_transition_leg`, `storage_event_id`, `storage_product_id`.

`current_app_role` / `is_master_user`: exist, EXECUTE not granted to `authenticated` (`20260919130200_private_grants.sql`).

`anon` EXECUTE revoked on those helpers.

### `service_role` EXECUTE only (anon/authenticated revoked)

Public RPCs:

* `apply_event_assortment`
* `next_product_code`, `next_sku_code`
* `start_event_inventory_check`, `confirm_event_inventory_check`
* `next_inventory_movement_no`, `dispatch_inventory_movement`, `receive_inventory_movement`, `apply_inventory_adjustment`, `create_closing_movements`
* `save_event_daily_sales`, `save_event_expense`, `void_event_expense`, `save_event_product_cost`, `event_finance_summary`

Edge Functions use the Secret Key client and call these RPCs. The browser cannot EXECUTE them.

All of the above public RPCs are SECURITY DEFINER with `search_path = ''`.

---

## Client / Server Secret Boundary

### Client (PWA)

* `VITE_SUPABASE_URL`
* `VITE_SUPABASE_PUBLISHABLE_KEY`

`app/src/lib/supabase.ts` refuses keys starting with `sb_secret_` or matching `service_role`.

`app/.env` is gitignored. Root `.env` / `.env.local` / `supabase/.env` are gitignored. Tracked templates: `.env.example`, `app/.env.example` (empty publishable value).

### Server / Edge / local scripts

* `SUPABASE_URL` (or CLI `API_URL` from `npx supabase status -o env`)
* `SUPABASE_SECRET_KEY` (Edge also accepts runtime `SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` if `SUPABASE_SECRET_KEY` is unset; publishable keys are rejected)

Secret Key must not appear in the Vite bundle. Verify scripts check the built assets. Do not put Secret values in `VITE_` variables.

Table writes from the browser: **none** (GRANT SELECT + RLS SELECT policies only). Privileged writes go through Edge + Secret Key.

---

## Event Access

`private.can_read_event`: ADMIN (in login window) **or** `event_members` for that event, and `has_app_access`.

| Domain | STAFF / PART_TIMER (assigned) | ADMIN |
| --- | --- | --- |
| Event | SELECT 배정 행사 일반정보 (계약 **금액** 컬럼 제외). Photo upload via Edge. No create/update/status/member write | All events; `commission_rate` / `fixed_fee`는 Edge `event-admin` (Secret). writes via `event-admin` (`add-member` / `remove-member`). `schedule_status` ADMIN |
| Preparation | SELECT event snapshot; `prep-admin` `get-event` / `set-status` | Templates (RLS ADMIN SELECT) + apply/structure |
| Setup | 배정 행사 get-setup, 도착/완료 사진, actual quantity/staff | 계획, fixture 계획, members, 시간보정, 거점, transition 계획 |
| Assortment | SELECT event snapshot; `get-event` | Templates + apply + manual SKU |
| Inventory | SELECT checks/current of assigned events; EVENT location/positions/movements involving that EVENT; create/save/confirm/cancel check; dispatch from / receive to that EVENT | HQ/TEMP/THIRD_PARTY, adjustments, draft create, closing distribution |
| Finance | See next section | Full including cost, P&L lines, audit, void, dashboard |

Unassigned STAFF/PART_TIMER: Edge 403 / RLS hides other events. Product master SELECT is `has_app_access` (any in-window role); product **write** is ADMIN Edge. Product UI routes use `AdminGuard` (UI only).

Login UI is split (`/admin/login` vs `/login`) but Auth/RLS is unchanged. STAFF signing in at `/admin/login` is signed out in the client. ADMIN `/login` is allowed and redirects to `/admin`.

### Organizer

| Data | STAFF / PART_TIMER | ADMIN | Protection |
| --- | --- | --- | --- |
| `event_organizers` name/color/active | SELECT (`has_app_access`) | Same + write Edge | No contract columns on this table |
| `event_organizer_terms` | **No** (RLS `is_admin_user`; Edge 403) | Edge `organizer-admin` | Same pattern as product cost |
| `event_organizer_contacts` | **No** (RLS ADMIN) | Edge add/update/deactivate | Event snapshot is `event_contacts` |
| Calendar DTO | assigned events only | all | `event-admin` `calendar` omits contract amounts; includes `schedule_status` |

---

## Finance Security

| Data | STAFF/PART_TIMER assigned | ADMIN | Protection |
| --- | --- | --- | --- |
| Daily sales rows | Read + save via Edge | Same | RLS `can_read_event`. No client INSERT. RPC `save_event_daily_sales` |
| Expenses | Read + create/update + receipt upload | + void, receipt delete | RLS `can_read_event`. Void/delete-receipt Edge `isAdmin` |
| Expense categories | SELECT (`has_app_access`); list via Edge | + upsert | RLS SELECT all with access; write ADMIN |
| Product cost | **No** | Read/write | RLS `event_financial_inputs` = `is_admin_user` only. Edge `update-product-cost` ADMIN. UI form ADMIN |
| Audit | **No** | Read | RLS `audit_logs` = ADMIN. Edge `get-audit-log` ADMIN. UI loads audit only if `isAdmin` |
| Computed P&L (cost, commission_amount, booth_fee, estimated_profit) | Edge `get-financial-summary` **strips** these fields | Full object | Edge filter. RPC itself is service_role-only |
| `events.contract_type` | SELECT 가능 (배정 RLS) | Same + edit | 유형만. 금액 아님 |
| `events.commission_rate`, `events.fixed_fee` | **No** (PostgREST column privilege 거부). `event-admin` `get` 응답에서도 키 제거 | Edge `event-admin` get/create/update | RLS는 row-level이라 컬럼 숨김에 쓰지 않음. `authenticated`에 해당 컬럼 SELECT 없음 |

Sales/expense **totals** remain in the STAFF summary payload (card/cash/other/sales/expense/days). STAFF cannot read `estimated_product_cost`, so they cannot complete the same profit formula the ADMIN summary uses.

---

## Storage Security

Live buckets (private, 10 MiB, image MIME). Storage RLS on `storage.objects`:

### `event-photos`

* **read:** authenticated AND `can_read_event(storage_event_id(name))`
* **upload (INSERT):** same as read (assigned or ADMIN)
* **delete:** `can_write_event` → ADMIN only

Edge `event-photos`: sign/complete for readers; `delete` ADMIN.

### `product-images`

* **read:** `has_app_access`
* **upload:** ADMIN AND path folder parses as product id
* **delete:** ADMIN AND same path rule

Edge `product-admin` image actions: ADMIN.

### `expense-receipts`

* **read:** `can_read_event` on folder UUID
* **upload:** same
* **delete:** `can_write_event` (ADMIN)

Edge: sign/complete for assigned; `delete-receipt` ADMIN.

### `setup-photos`

* **read:** authenticated AND `can_read_event(storage_event_id(name))`
* **upload (INSERT):** same as read
* **delete:** no storage DELETE policy

Edge `event-ops`: sign/complete for assigned readers. Arrival sets `arrival_recorded_at = now()`; completion requires arrival. Raw timestamps are not client-supplied.

Uploads use **signed URLs** issued by Edge (Secret Key), not anonymous public URLs.

---

## Housekeeping (not done in this change)

`events` table catalog comment still says “P&L is a later phase”. Finance exists. Do not edit old migrations or add a comment-only migration here. Track as future schema housekeeping.
