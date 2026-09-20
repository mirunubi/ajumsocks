# Architecture

Source: live PostgreSQL after migrations through `20260919200000_event_finance.sql`, plus current Edge Functions and `app/` code.

This document describes **what is implemented now**. It is not a roadmap. Supplier / Purchase Order / Shipment / POS / automatic COGS tables and flows do not exist and are not documented as current behavior.

Public business tables: **40**. Cross-check: `docs/SCHEMA_INVENTORY.md`, `docs/ERD.md`.

---

## System Overview

Implemented stack:

| Layer | Actual |
| --- | --- |
| App | Vite 6 + React 18 + TypeScript. `vite-plugin-pwa` (standalone, `registerType: autoUpdate`) |
| Auth | Supabase Auth. Phone is normalized to a synthetic email (`…@users.local.ajumsocks`). Password sign-in. No SMS OTP in this codebase |
| Data | PostgreSQL (`public` schema). Enums + CHECK constraints |
| Access | RLS on every public business table (`FORCE ROW LEVEL SECURITY`). Authenticated clients receive **SELECT** grants only |
| Write path | Edge Functions with Secret Key, plus `service_role`-only RPCs for transactional writes |
| Files | Supabase Storage (private buckets). Metadata in Postgres; bytes in Storage |

```text
PWA (Vite / React)
  ↓  Publishable Key + user JWT
Supabase Auth
  ↓
RLS SELECT  /  Edge Function (Secret Key)
  ↓
RPC (service_role)  /  PostgreSQL
  ↓
Storage (signed upload / signed read)
```

Browser env is only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The client rejects `sb_secret_` / `service_role` keys at startup (`app/src/lib/supabase.ts`).

---

## Domain

### Auth / User

* **책임:** Auth 세션과 앱 접근을 분리한다. `profiles`가 역할, MASTER 여부, 활성, 로그인 허용 기간을 가진다. 초대 토큰은 hash만 저장한다.
* **주요 Table:** `profiles`, `invites` (외부 `auth.users`)
* **주요 Edge Function:** `user-admin` (ADMIN), `invite-accept` (토큰, 비로그인 preview/accept)
* **연결:** `event_members.profile_id`. 거의 모든 쓰기 행의 `created_by` / `updated_by` / actor.

### Event

* **책임:** 외부 판매 행사 헤더, 배정, 외부 담당자, 행사 사진, 계약 필드, 운영 status.
* **주요 Table:** `events`, `event_members`, `event_contacts`, `event_photos`
* **주요 Edge Function:** `event-admin`, `event-photos`
* **연결:** Preparation / Assortment / Inventory / Finance / Audit가 모두 `events.id`를 가리킨다. INSERT 시 EVENT `inventory_locations` 행이 트리거로 생긴다. Dates do not auto-change `status`.

### Preparation

* **책임:** 집기·소모품 마스터와 세트 템플릿, 행사별 Snapshot.
* **주요 Table:** `preparation_items`, `preparation_sets`, `preparation_set_items`, `event_preparation_plans`, `event_preparation_items`
* **주요 Edge Function:** `prep-admin`
* **연결:** Event. 판매 SKU / 재고 수량과 무관.

### Product

* **책임:** 판매 상품 마스터, Variant(SKU), 카테고리/사이즈/컬러/태그/속성/이미지.
* **주요 Table:** `products`, `product_variants`, `product_categories`, `sizes`, `colors`, `tags`, `product_tags`, `attribute_definitions`, `product_attribute_values`, `product_images`
* **주요 Edge Function:** `product-admin`
* **연결:** Assortment 규칙·Event Snapshot·Inventory Check/Position/Movement item이 `product_variants.id`를 사용한다.

### Assortment

* **책임:** “이 행사에서 취급하는 SKU 범위”. 수량 없음.
* **주요 Table:** `assortment_sets`, `assortment_set_rules`, `event_assortments`, `event_assortment_items`
* **주요 Edge Function:** `assortment-admin`
* **연결:** Product Variant → Event Snapshot → Inventory Check items / Current.

### Inventory Check

* **책임:** 현장 실사 세션. 근사 재고(팩 + remainder band). Movement가 아니다.
* **주요 Table:** `event_inventory_checks`, `event_inventory_check_items`, `event_inventory_current`
* **주요 Edge Function:** `event-inventory`
* **연결:** Assortment items에서 대상 SKU를 만든다. Confirm RPC가 Current를 덮어쓰고 EVENT location `inventory_positions`를 재기준화한다.

### Inventory Location / Movement

* **책임:** 장소, 운영 예상재고, 장소 간 이동, 수동 Adjustment, 종료 재고 분배.
* **주요 Table:** `inventory_locations`, `inventory_positions`, `inventory_movements`, `inventory_movement_items`, `inventory_adjustments`, `inventory_movement_counters`
* **주요 Edge Function:** `inventory-movement`
* **연결:** Event → EVENT location. Check confirm → Positions. Movement는 Current를 바꾸지 않는다.

### Finance

* **책임:** 일매출 금액, 지출, 영수증, ADMIN 수동 상품원가, 계약 기반 요약. 재고/판매수량과 연결하지 않는다.
* **주요 Table:** `event_daily_sales`, `expense_categories`, `event_expenses`, `event_expense_receipts`, `event_financial_inputs`
* **주요 Edge Function:** `event-finance`
* **연결:** `events`의 `contract_type` / `commission_rate` / `fixed_fee`. Inventory 테이블에 FK 없음.

### Audit

* **책임:** Finance 원본 변경이력 (CREATE / UPDATE / VOID).
* **주요 Table:** `audit_logs`
* **주요 Edge Function:** `event-finance` (`get-audit-log`, 쓰기는 finance RPC의 `private.write_audit`)
* **연결:** `event_id` nullable. `entity_type`은 `DAILY_SALES` / `EXPENSE` / `PRODUCT_COST`만.

---

## 중요한 흐름

### 행사

```text
events
  → event_members          (N:M 배정. assignment_role ≠ profiles.role)
  → event_contacts / event_photos
  → prep-admin apply-set   → event_preparation_plans + event_preparation_items
  → assortment-admin apply → event_assortments + event_assortment_items
```

Template 적용은 copy이다. 이후 템플릿을 고쳐도 이미 만든 Event Snapshot 컬럼은 자동 갱신되지 않는다. 같은 행사에 세트 재적용은 거부된다 (`UNIQUE event_id`).

### 상품

```text
products
  → product_variants (SKU)
  → assortment_set_rules (필터)
  → apply_event_assortment
  → event_assortment_items (코드/이름/SKU snapshot, 수량 컬럼 없음)
```

재고·발주 단위는 Variant이다. Product는 공통 속성이다.

### 재고

```text
event_assortment_items
  → start_event_inventory_check   (OPENING / ROUTINE / CLOSING)
  → event_inventory_check_items   (NULL pair = 미입력, ZERO = 빈 것)
  → confirm_event_inventory_check
       ├─ event_inventory_current   (마지막 CONFIRMED 실사)
       └─ inventory_positions       (해당 EVENT location 운영 예상 재기준화)
  → inventory_movements / items    (DISPATCH 출고, RECEIVE 입고)
  → inventory_adjustments          (운영 예상을 지정 값으로 설정. movement 이력은 유지)
  → 새 Check confirm               (Current와 EVENT position을 다시 실사 기준으로)
```

`event_inventory_current`는 Movement를 반영하지 않는다. `inventory_positions`는 반영한다. 둘을 같은 “현재고”로 취급하지 않는다.

### Finance

```text
event_daily_sales          (일별 카드/현금/기타 금액. 상품 수량 아님)
+ event_expenses           (voided_at IS NULL만 합계)
+ event_financial_inputs.estimated_product_cost   (ADMIN 수동. NULL ≠ 0)
+ events.contract_type / commission_rate / fixed_fee
        ↓
event_finance_summary RPC
  sales_total
  − estimated_product_cost   (NULL이면 profit_ready = false)
  − expense_total
  − commission_amount        (COMMISSION/MIXED: round(sales * rate / 100))
  − booth_fee                (FIXED_FEE/MIXED: events.fixed_fee)
  = estimated_profit
```

**Daily Sales / Expenses / Product Cost는 Inventory Check, Position, Movement와 FK도 없고 자동 차감도 없다.** 매출 입력이 재고를 바꾸지 않는다.

---

## Client / Server Boundary

### Client (PWA)

허용:

* Publishable Key
* Auth session (JWT)
* `profiles` / `events` / `event_preparation_items` 등 RLS SELECT
* 사용자 입력 → Edge Function POST
* Storage **signed** upload (Edge가 URL 발급)

금지 (코드·권한 모두):

* Secret Key / service_role JWT
* public table INSERT / UPDATE / DELETE (정책 없음, GRANT SELECT만)
* 브라우저가 ADMIN 여부를 최종 결정하는 것. `AdminGuard`는 UI 가드일 뿐이며 쓰기는 Edge + RLS가 막는다

로그인 가능 조건은 Auth 세션이 아니라 `profiles`: `is_active` 그리고 `login_allowed_from` / `login_allowed_until` (`private.has_app_access` / `evaluateAccess`).

### Edge / RPC

Edge는 Secret Key 클라이언트(`supabase/functions/_shared/supabase.ts`)로 호출자 JWT를 검증한 뒤 권한을 검사하고 쓴다.

| Function | 공개 | 쓰기 주체 (구현) |
| --- | --- | --- |
| `invite-accept` | preview / accept (JWT 없이 토큰) | 초대 수락 시 Auth 사용자 + profile 활성 |
| `user-admin` | 없음 | ADMIN only |
| `event-admin` | `get` = 배정 또는 ADMIN | create/update/status/member/contact = ADMIN |
| `event-photos` | 배정자 업로드 | delete = ADMIN |
| `prep-admin` | `get-event`, `set-status` = 배정 또는 ADMIN | 템플릿·apply·snapshot 구조 변경 = ADMIN |
| `product-admin` | `list-masters` / `list-products` / `get` = app access | 나머지 = ADMIN |
| `assortment-admin` | `get-event` = 배정 또는 ADMIN | 세트/규칙/apply/수동 SKU = ADMIN |
| `event-inventory` | 배정 또는 ADMIN | create/save/confirm/cancel check |
| `inventory-movement` | 목록/조회: ADMIN 또는 EVENT location 배정 | location/draft/adjustment/closing = ADMIN. dispatch = ADMIN 또는 출발 EVENT 배정. receive = ADMIN 또는 도착 EVENT 배정 |
| `event-finance` | 매출/지출/요약(원가·손익 제외) = 배정 | void/receipt delete/원가/audit/dashboard/category upsert = ADMIN |

`service_role` 전용 RPC (anon/authenticated EXECUTE 없음):

* Assortment: `apply_event_assortment`
* Product codes: `next_product_code`, `next_sku_code`
* Inventory: `start_event_inventory_check`, `confirm_event_inventory_check`, `next_inventory_movement_no`, `dispatch_inventory_movement`, `receive_inventory_movement`, `apply_inventory_adjustment`, `create_closing_movements`
* Finance: `save_event_daily_sales`, `save_event_expense`, `void_event_expense`, `save_event_product_cost`, `event_finance_summary`

RLS SELECT 요약:

* ADMIN (`private.is_admin_user`): 로그인 창이 열린 ADMIN. 행사 전체, 템플릿, 원가, audit, adjustment
* 배정 (`private.can_read_event`): 해당 행사 행. `events.commission_rate` / `fixed_fee`는 column privilege로 `authenticated` SELECT 불가 (ADMIN도 PostgREST로는 못 읽음; Edge Secret 경로만)
* 상품 마스터 SELECT: `private.has_app_access` (역할 무관, 접근창만)
* 준비 템플릿 SELECT: ADMIN only
* 동료 `profiles`: 같은 행사 배정자의 이름/전화 SELECT 가능. MASTER 행 쓰기(역할·비활성·삭제)는 트리거로 보호
* HQ/TEMP/THIRD_PARTY location·position: ADMIN only (`can_read_location`은 EVENT + 배정, 또는 ADMIN)
* `inventory_movement_counters`: authenticated GRANT 없음

---

## Storage

Live `storage.buckets` (private, 10 MiB, image MIME):

| Bucket | Metadata table | Path 관례 | Edge |
| --- | --- | --- | --- |
| `event-photos` | `event_photos` | `{event_id}/…` | `event-photos` |
| `product-images` | `product_images` | `{product_id}/…` | `product-admin` |
| `expense-receipts` | `event_expense_receipts` | `{event_id}/…` | `event-finance` |

다른 bucket은 없다. Object는 public이 아니며 읽기는 signed URL 또는 Storage RLS SELECT다.

Storage RLS:

* `event-photos` / `expense-receipts`: SELECT·INSERT = `can_read_event` on folder UUID. DELETE = `can_write_event` (ADMIN)
* `product-images`: SELECT = `has_app_access`. INSERT·DELETE = ADMIN
