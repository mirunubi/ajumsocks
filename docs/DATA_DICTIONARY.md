# Data Dictionary

Source: live `pg_catalog` and `supabase/migrations/` through `20260920160000_event_organizers.sql`. Edge write paths are from `supabase/functions/`.

Public business tables: **43**. Same set as `docs/SCHEMA_INVENTORY.md`. Future tables are not listed.

Column dumps are omitted. Key fields are the identifiers and business-meaning columns.

Write pattern (all public business tables unless noted):

* Authenticated: **SELECT only** + RLS
* Writes: Edge Function + Secret Key, often a `service_role` RPC
* No client INSERT/UPDATE/DELETE policies on these tables

---

## Meaning differences

### Product vs Variant

* **Product** (`products`): 공통 상품. 이름, 코드, 카테고리, 기본 팩입수, 가격 필드.
* **Variant** (`product_variants`): 실제 SKU (`sku_code`). 사이즈·컬러. 재고 Check / Position / Movement item의 단위. 현재 발주 테이블은 없다.

### Preparation vs Assortment

* **Preparation:** 집기(`EQUIPMENT`)·소모품(`CONSUMABLE`). 판매 상품이 아님.
* **Assortment:** 행사에서 취급하는 판매 SKU 범위. 수량 없음.

### Assortment vs Inventory

* **Assortment:** 무엇을 파는가 (SKU 목록 snapshot).
* **Inventory:** 얼마나 있는가 (실사 또는 운영 예상 수량).

### Physical Current vs Position

* **`event_inventory_current`:** 마지막 **CONFIRMED physical check** 결과. Movement/Adjustment를 적용하지 않음.
* **`inventory_positions`:** 실사 confirm 이후 **Movement DISPATCH/RECEIVE와 Adjustment까지 반영한 운영 예상재고**. 정확 실물재고가 아님.

### Missing vs Zero

* **재고 Check item:** `full_pack_count`/`remainder_level` NULL pair = 미실사. `remainder_level = ZERO` = 확인된 빈 재고.
* **일매출:** 해당일 row 없음 = 미입력. row가 있고 금액 0 = 확인된 0원.
* **상품원가:** `estimated_product_cost` NULL = 미입력 (손익 미완료). `0` = 확인된 0원.

---

## assortment_set_rules

Purpose: 세트 안 AND 필터 한 줄. 여러 rule은 OR.
Primary Key: `id`
Main Foreign Keys: `assortment_set_id` → `assortment_sets` CASCADE; optional `category_id`, `tag_id`, `size_id`, `color_id`, `product_id`, `product_variant_id`
Key Fields: `include_descendants`, `sort_order`
Important Constraints: `has_filter` — 필터 컬럼 중 최소 1개 NOT NULL
Write Authority: Edge `assortment-admin` (ADMIN)
Delete / History Policy: 세트 삭제 시 CASCADE. Snapshot `source_rule_id`는 SET NULL
Important Notes: 범용 쿼리 언어가 아니다.

## assortment_sets

Purpose: 재사용 SKU 범위 템플릿. 재고 수량 없음.
Primary Key: `id`
Main Foreign Keys: `created_by` → `profiles` SET NULL
Key Fields: `name`, `is_active`
Important Constraints: name not blank
Write Authority: Edge `assortment-admin` (ADMIN). SELECT: ADMIN RLS
Delete / History Policy: 물리 삭제 시 rules CASCADE. 이미 적용된 `event_assortments.source_assortment_set_id`는 RESTRICT
Important Notes: Event Snapshot과 동기화되지 않음.

## attribute_definitions

Purpose: 상품 속성 정의.
Primary Key: `id`
Main Foreign Keys: none
Key Fields: `code`, `name`, `value_type`, `option_values`
Important Constraints: UNIQUE `code`; `value_type` in TEXT, NUMBER, BOOLEAN, SELECT
Write Authority: Edge `product-admin` (ADMIN). SELECT: `has_app_access`
Delete / History Policy: values가 RESTRICT로 참조
Important Notes: 값은 `product_attribute_values`에 저장.

## audit_logs

Purpose: Finance 변경이력. 앱이 직접 INSERT하지 않는다.
Primary Key: `id`
Main Foreign Keys: `event_id` → `events` RESTRICT (nullable); `actor_profile_id` → `profiles` SET NULL
Key Fields: `entity_type`, `entity_id`, `action`, `before_data`, `after_data`, `reason`
Important Constraints: `entity_type` in DAILY_SALES, EXPENSE, PRODUCT_COST; `action` in CREATE, UPDATE, VOID
Write Authority: `private.write_audit` from finance RPCs. SELECT: ADMIN. Edge `get-audit-log` ADMIN
Delete / History Policy: append-only. 물리 삭제 정책/클라이언트 경로 없음
Important Notes: Inventory·Event 헤더 변경은 기록하지 않는다.

## colors

Purpose: 색상 마스터.
Primary Key: `id`
Main Foreign Keys: none
Key Fields: `code`, `name`, `color_family`, `is_active`
Important Constraints: UNIQUE `code`
Write Authority: Edge `product-admin` masters. SELECT: `has_app_access`
Delete / History Policy: variant/rule이 RESTRICT
Important Notes: Variant의 `primary_color_id`는 nullable.

## event_assortment_items

Purpose: 행사에서 취급하는 SKU **Snapshot**. **수량 컬럼 없음.**
Primary Key: `id`
Main Foreign Keys: `event_assortment_id`, `event_id`, `product_id`, `product_variant_id`; optional `source_rule_id` SET NULL
Key Fields: `source_type` (TEMPLATE / MANUAL), `product_code_snapshot`, `product_name_snapshot`, `sku_code_snapshot`, `size_snapshot`, `color_snapshot`, `category_snapshot`, `removed_at`
Important Constraints: UNIQUE (`event_assortment_id`, `product_variant_id`); `source_type` allowed
Write Authority: Edge `assortment-admin` apply / add-event-item / remove-event-item (ADMIN). SELECT: 배정 또는 ADMIN
Delete / History Policy: `removed_at`로 제외. 행 물리 삭제 대신 표시에서 뺌. Inventory item이 RESTRICT로 참조
Important Notes: UI는 snapshot 컬럼을 보여야 한다. 마스터 상품명 변경이 이 행을 자동 갱신하지 않는다. “얼마나 있는가”는 Inventory 쪽.

## event_assortments

Purpose: 행사당 SKU 범위 헤더 1개.
Primary Key: `id`
Main Foreign Keys: `event_id` UNIQUE NOT NULL; optional `source_assortment_set_id`; `applied_by`
Key Fields: `applied_at`
Important Constraints: UNIQUE `event_id`
Write Authority: RPC `apply_event_assortment` via `assortment-admin` (ADMIN)
Delete / History Policy: 재적용 거부. items는 RESTRICT
Important Notes: 템플릿 없이도 이후 수동 SKU 추가가 가능하다 (`source_type = MANUAL`).

## event_contacts

Purpose: 현장/본사 외부 담당자. 앱 사용자가 아님.
Primary Key: `id`
Main Foreign Keys: `event_id` CASCADE
Key Fields: `contact_type` (VENUE, HQ, OTHER), `name`, `phone`
Important Constraints: name not blank
Write Authority: Edge `event-admin` add/update-contact (ADMIN). SELECT: 배정 또는 ADMIN
Delete / History Policy: 행사 삭제 시 CASCADE (행 삭제는 일반 경로에서 RESTRICT된 events 때문에 실사용되지 않음)
Important Notes: `profiles`와 무관.

## event_daily_sales

Purpose: 수동 **일별 매출 금액**. 상품 판매수량이 아님.
Primary Key: `id`
Main Foreign Keys: `event_id` RESTRICT; `created_by` / `updated_by` SET NULL
Key Fields: `business_date`, `card_amount`, `cash_amount`, `other_amount`
Important Constraints: UNIQUE (`event_id`, `business_date`); amounts >= 0. 합계는 저장하지 않고 계산
Write Authority: RPC `save_event_daily_sales` via `event-finance` (배정 STAFF/PART_TIMER 또는 ADMIN). SELECT: `can_read_event`
Delete / History Policy: upsert. Audit CREATE/UPDATE. Inventory와 무관
Important Notes: row 없음 ≠ 0원. 0원 3종 = 확인된 0. 매출 저장이 Position/Current를 바꾸지 않는다.

## event_expense_receipts

Purpose: 영수증 메타데이터. 바이트는 Storage `expense-receipts`.
Primary Key: `id`
Main Foreign Keys: `expense_id`, `event_id`; `uploaded_by` SET NULL
Key Fields: `storage_path`, `mime_type`, `file_size`
Important Constraints: UNIQUE `storage_path`; file_size > 0
Write Authority: Edge `event-finance` sign/complete (배정 또는 ADMIN). delete-receipt = ADMIN
Delete / History Policy: 메타 + Storage object 삭제 (ADMIN). expense는 RESTRICT라 void와 별개
Important Notes: path 첫 폴더 = `event_id`.

## event_expenses

Purpose: 행사 운영 지출.
Primary Key: `id`
Main Foreign Keys: `event_id`, `expense_category_id`; created/updated/voided_by → profiles
Key Fields: `expense_date`, `amount`, `payment_method` (CARD, CASH, OTHER), `voided_at`
Important Constraints: amount >= 0; payment_method allowed
Write Authority: RPC `save_event_expense` (배정 또는 ADMIN). `void_event_expense` = ADMIN only
Delete / History Policy: 물리 삭제 없음. `voided_at`이 손익에서 제외. Audit VOID
Important Notes: 지출일은 행사 기간 밖을 허용한다 (migration comment). void ≠ inventory 조정.

## event_financial_inputs

Purpose: 행사당 ADMIN 수동 금융 입력. 지금은 예상 상품원가.
Primary Key: `event_id` (identifying FK)
Main Foreign Keys: `event_id` → `events`; `updated_by` SET NULL
Key Fields: `estimated_product_cost`, `memo`
Important Constraints: cost NULL or >= 0
Write Authority: RPC `save_event_product_cost` via `update-product-cost` (ADMIN). SELECT RLS: ADMIN only. STAFF summary에서 cost/profit 필드 제거
Delete / History Policy: PK upsert. Audit PRODUCT_COST
Important Notes: NULL = 미입력 (`profit_ready` false). 0 = 확인된 0원. 재고에서 원가를 계산하지 않음.

## event_inventory_check_items

Purpose: 실사 세션의 SKU 한 줄. 추정 수량은 저장하지 않고 pack+remainder로 계산한다.
Primary Key: `id`
Main Foreign Keys: `inventory_check_id`, `event_id`, `event_assortment_item_id`, `product_variant_id`; `checked_by`
Key Fields: `pack_size_snapshot`, `full_pack_count`, `remainder_level`, `checked_at`
Important Constraints: UNIQUE (`inventory_check_id`, `product_variant_id`); remainder in ZERO, VERY_LOW, HALF, HIGH, FULL; pack과 remainder는 둘 다 NULL이거나 둘 다 값
Write Authority: Edge `event-inventory` save-item (배정 또는 ADMIN). SELECT: `can_read_event`
Delete / History Policy: Check header와 함께 유지. CONFIRMED 후 item 변경은 RPC가 막음
Important Notes: NULL pair = 미실사. ZERO remainder = 빈 재고. midpoint: ZERO=0, VERY_LOW=2, HALF=5, HIGH=8, FULL=10 (팩입수 10 기준 근사).

## event_inventory_checks

Purpose: 현장 근사 실사 **세션**. Movement가 아님.
Primary Key: `id`
Main Foreign Keys: `event_id`; `started_by`, `confirmed_by`
Key Fields: `check_kind` (OPENING, ROUTINE, CLOSING), `check_scope` (FULL, PARTIAL), `status` (DRAFT, CONFIRMED, CANCELLED)
Important Constraints: kind/scope/status CHECKs
Write Authority: RPC `start_event_inventory_check` / `confirm_event_inventory_check`; Edge cancel. 배정 또는 ADMIN
Delete / History Policy: CANCELLED 가능. CONFIRMED 이력은 Current/Position이 참조 (RESTRICT / SET NULL)
Important Notes: FULL confirm은 모든 item이 쌍으로 채워져야 한다. PARTIAL은 1줄 이상. Confirm이 Current를 덮고 EVENT location Position을 재기준화한다.

## event_inventory_current

Purpose: 마지막 **CONFIRMED physical check** 결과. Movement 반영 Current가 아님.
Primary Key: `id`
Main Foreign Keys: `event_id`, `event_assortment_item_id`, `product_variant_id`, `source_check_id` NOT NULL; `updated_by`
Key Fields: `pack_size_snapshot`, `full_pack_count`, `remainder_level`, `first_recognized_at`
Important Constraints: UNIQUE (`event_id`, `product_variant_id`); remainder always set; packs >= 0
Write Authority: `confirm_event_inventory_check` RPC only. SELECT: `can_read_event`
Delete / History Policy: upsert on confirm. Check 이력은 `event_inventory_checks`에 남음
Important Notes: 이후 DISPATCH/RECEIVE/Adjustment는 이 테이블을 갱신하지 않는다. “지금 현장에 있을 법한 운영 수량”은 `inventory_positions`.

## event_members

Purpose: 행사↔사용자 N:M 배정.
Primary Key: `id`
Main Foreign Keys: `event_id` RESTRICT, `profile_id` RESTRICT, `created_by`
Key Fields: `assignment_role` (MANAGER, STAFF, PART_TIMER)
Important Constraints: UNIQUE (`event_id`, `profile_id`)
Write Authority: Edge `event-admin` add-member (ADMIN). SELECT: 배정 또는 ADMIN
Delete / History Policy: 행을 이력으로 유지 (comment). 배정이 RLS `can_read_event`의 기준
Important Notes: `assignment_role`은 `profiles.role`과 독립.

## event_organizer_contacts

Purpose: 주최자 담당자 Master. 행사 생성 시 `event_contacts`로 복사한다.
Primary Key: `id`
Main Foreign Keys: `organizer_id` → `event_organizers` RESTRICT
Key Fields: `contact_type`, `name`, `department`, `position`, `phone`, `email`, `is_active`
Important Constraints: name not blank. `event_contact_type` 재사용 (VENUE/HQ/OTHER)
Write Authority: Edge `organizer-admin` (ADMIN). SELECT RLS: ADMIN only
Delete / History Policy: 물리삭제 없음. `is_active=false`
Important Notes: Master 변경은 기존 event_contacts를 바꾸지 않는다.

## event_organizer_terms

Purpose: 주최자 기본 계약조건. ADMIN only.
Primary Key: `organizer_id`
Main Foreign Keys: `organizer_id` 1:1; `updated_by`
Key Fields: `default_contract_type`, `default_commission_rate`, `default_fixed_fee`, `memo`
Important Constraints: events와 같은 계약값 CHECK
Write Authority: Edge `organizer-admin` upsert-terms (ADMIN). SELECT RLS: `is_admin_user`
Delete / History Policy: Organizer와 RESTRICT
Important Notes: 기본값은 새 행사 Snapshot 원본일 뿐. 기존 events 계약은 불변.

## event_organizers

Purpose: 행사 주최자/행사장 운영사. 상품 도매사(Supplier)가 아니다.
Primary Key: `id`
Main Foreign Keys: `created_by` nullable
Key Fields: `name`, `calendar_color`, `is_active`
Important Constraints: unique lower(btrim(name)); color `#RRGGBB`
Write Authority: Edge `organizer-admin` (ADMIN). SELECT: `has_app_access` (이름/색상만, 금융 컬럼 없음)
Delete / History Policy: 물리삭제 없음. `is_active=false`. 과거 events.organizer_id 유지
Important Notes: 계약금액은 이 테이블에 두지 않는다.

## event_photos

Purpose: 행사 사진 메타. 바이트는 `event-photos`.
Primary Key: `id`
Main Foreign Keys: `event_id` RESTRICT; `uploaded_by` nullable
Key Fields: `storage_path`, `photo_type`, `caption`
Important Constraints: unique `storage_path`; file_size > 0
Write Authority: Edge `event-photos` (배정 업로드, ADMIN 삭제)
Delete / History Policy: 메타 + Storage 삭제 (ADMIN)
Important Notes: events ON DELETE RESTRICT.

## event_preparation_items

Purpose: 준비물 **Event Snapshot**. UI는 snapshot 컬럼을 쓴다.
Primary Key: `id`
Main Foreign Keys: `plan_id`, `event_id`; optional `source_preparation_item_id`; `updated_by`
Key Fields: `item_name_snapshot`, `item_type_snapshot`, `unit_snapshot`, `planned_quantity`, `requires_return`, `status` (NOT_READY, READY, ON_SITE, RETURNED), `removed_at`
Important Constraints: planned_quantity >= 1; 소모품은 `requires_return` 없이 RETURNED 불가; partial unique (event, source) WHERE removed_at IS NULL
Write Authority: `prep-admin` set-status (배정 또는 ADMIN). add/update/remove-event-item = ADMIN
Delete / History Policy: `removed_at` soft remove
Important Notes: 템플릿 `preparation_items.name`을 바꿔도 snapshot 이름은 그대로. 판매 SKU/재고 아님.

## event_preparation_plans

Purpose: 행사당 준비 계획 헤더 1개.
Primary Key: `id`
Main Foreign Keys: `event_id` UNIQUE; optional `source_preparation_set_id`; `applied_by`
Key Fields: `applied_at`
Important Constraints: UNIQUE `event_id`
Write Authority: `prep-admin` apply-set (ADMIN)
Delete / History Policy: 재적용 거부
Important Notes: 템플릿 copy 후 수동 라인 추가 가능.

## events

Purpose: 외부 판매 행사 기본 Entity. 계약 필드와 운영 status를 가진다.
Primary Key: `id`
Main Foreign Keys: `created_by` → `profiles` (nullable); `organizer_id` → `event_organizers` (nullable)
Key Fields: `name`, `starts_at`, `ends_at`, `status` (PREPARING, ACTIVE, ENDED, SETTLED, CANCELLED), `venue_name`, `address`, `organizer_id`, `contract_type` (NONE, COMMISSION, FIXED_FEE, MIXED), `commission_rate`, `fixed_fee`
Important Constraints: ends_at >= starts_at; 공백 금지; COMMISSION이면 rate 필수; FIXED_FEE이면 fee 필수; MIXED면 둘 다; rate 0–100
Write Authority: Edge `event-admin` (ADMIN). SELECT (PostgREST): 배정 또는 ADMIN, 단 `commission_rate` / `fixed_fee`는 `authenticated` GRANT 없음. 계약 금액은 ADMIN Edge `get`만
Delete / History Policy: 대부분 자식이 ON DELETE RESTRICT. `event_contacts`만 CASCADE. 날짜가 status를 자동 변경하지 않음
Important Notes: INSERT 트리거가 EVENT `inventory_locations` 1행을 만든다 (부분 UNIQUE). Finance 요약이 계약 필드를 읽는다. P&L 숫자는 이 테이블에 저장하지 않음. STAFF는 `contract_type`만 볼 수 있고 수수료율/입점비 금액은 볼 수 없다. `organizer_id` NULL = 주최자 미지정(기존 행사). 신규 UI는 Organizer 필수.

## expense_categories

Purpose: 지출 분류 마스터.
Primary Key: `id`
Main Foreign Keys: none
Key Fields: `code`, `name`, `is_active`
Important Constraints: UNIQUE `code`
Write Authority: `event-finance` upsert-category (ADMIN). SELECT: `has_app_access`
Delete / History Policy: expenses RESTRICT
Important Notes: seed: FOOD, PARKING, TRANSPORT, LODGING, DELIVERY, SUPPLIES, LABOR, OTHER.

## inventory_adjustments

Purpose: 운영 예상재고를 확인된 근사치로 **설정**. Movement 이력을 다시 쓰지 않음.
Primary Key: `id`
Main Foreign Keys: `location_id`, `product_variant_id`; `created_by`
Key Fields: `before_estimated_units`, `after_estimated_units`, `reason`
Important Constraints: after >= 0; reason not blank
Write Authority: RPC `apply_inventory_adjustment` via `inventory-movement` (ADMIN). SELECT: ADMIN
Delete / History Policy: append. Position만 갱신. Current 불변
Important Notes: 정확 실물 확정이 아니라 운영 투영 수정.

## inventory_locations

Purpose: 재고 장소. EVENT는 행사와 1:1 (부분 UNIQUE + 트리거).
Primary Key: `id`
Main Foreign Keys: `event_id` nullable RESTRICT; `created_by`
Key Fields: `location_type` (HQ, EVENT, TEMP, THIRD_PARTY), `name`, `is_active`
Important Constraints: EVENT면 event_id NOT NULL, 그 외 event_id NULL; unique HQ; unique EVENT per event_id
Write Authority: `inventory-movement` create/update-location (ADMIN). Event insert가 EVENT location 자동 생성
Delete / History Policy: movements/positions RESTRICT
Important Notes: STAFF는 배정 EVENT location만 읽는다. HQ는 ADMIN.

## inventory_movement_counters

Purpose: 일별 Movement 번호 시퀀스.
Primary Key: `day`
Main Foreign Keys: none
Key Fields: `last_n`
Important Constraints: PK
Write Authority: RPC `next_inventory_movement_no` (service_role). authenticated GRANT 없음
Delete / History Policy: 번호 전용
Important Notes: 재고 Entity가 아님. 형식 `MV-YYYYMMDD-NNNN`.

## inventory_movement_items

Purpose: 이동 라인. **보낸 수량과 받은 수량이 별도.**
Primary Key: `id`
Main Foreign Keys: `inventory_movement_id` RESTRICT, `product_variant_id`
Key Fields: `sent_full_pack_count`, `sent_remainder_level`, `sent_estimated_units`, `received_*` (nullable until receive)
Important Constraints: UNIQUE (`inventory_movement_id`, `product_variant_id`); received 3컬럼은 모두 NULL이거나 모두 값
Write Authority: Edge draft add/remove (ADMIN). receive 시 received_* 채운 뒤 `receive_inventory_movement`
Delete / History Policy: header 상태에 따라 item 변경 트리거 가드. 차이 = 판매/분실로 자동 분류하지 않음
Important Notes: sent ≠ received를 허용하고 보존한다.

## inventory_movements

Purpose: 두 Location 사이 **실제 이동** (근사 수량). 목적지 1개.
Primary Key: `id`
Main Foreign Keys: `source_location_id`, `destination_location_id` (둘 다 NOT NULL, 서로 달라야 함); optional `source_event_inventory_check_id`; actor FKs
Key Fields: `movement_no` UNIQUE, `status` (DRAFT, DISPATCHED, RECEIVED, CANCELLED)
Important Constraints: status CHECK; source ≠ dest
Write Authority: create/update/cancel-draft/closing = ADMIN. dispatch = ADMIN 또는 출발 EVENT 배정. receive = ADMIN 또는 도착 EVENT 배정. RPC dispatch/receive
Delete / History Policy: DELETE 금지 트리거. DRAFT만 CANCELLED. DISPATCHED/RECEIVED 불변(상태 전이 외)
Important Notes: DRAFT는 Position 불변. DISPATCH는 source Position 감소. RECEIVE는 dest Position 증가. Current 불변.

## inventory_positions

Purpose: Location×SKU **운영 예상재고**. 정확 실물재고가 아님.
Primary Key: `id`
Main Foreign Keys: `location_id`, `product_variant_id`; optional `last_physical_check_id` SET NULL; `updated_by`
Key Fields: `estimated_units`
Important Constraints: UNIQUE (`location_id`, `product_variant_id`); estimated_units >= 0
Write Authority: confirm check / dispatch / receive / adjustment RPCs. SELECT: `can_read_location`
Delete / History Policy: 이력은 checks, movements, adjustments에 남김. 이 테이블은 투영
Important Notes: EVENT location은 실사 confirm으로 재기준화된다. 그 사이 이동은 여기만 바뀐다. `event_inventory_current`와 값이 갈라질 수 있다.

## invites

Purpose: 일회성 초대. **원문 토큰을 저장하지 않고 hash만.**
Primary Key: `id`
Main Foreign Keys: `profile_id` CASCADE, `created_by`
Key Fields: `token_hash`, `expires_at`, `used_at`, `revoked_at`
Important Constraints: unique `token_hash`; 활성 초대 1개 per profile (used/revoked NULL)
Write Authority: `user-admin` create/reissue/revoke (ADMIN). `invite-accept`가 used_at 기록
Delete / History Policy: revoke는 `revoked_at`. profile 삭제 시 CASCADE
Important Notes: SELECT RLS ADMIN. 수락 화면은 hash 대조.

## preparation_items

Purpose: 집기/소모품 마스터. 판매 SKU 아님.
Primary Key: `id`
Main Foreign Keys: `created_by`
Key Fields: `name`, `item_type`, `default_unit`, `requires_return`, `is_active`
Important Constraints: name/unit not blank
Write Authority: `prep-admin` upsert-item (ADMIN). SELECT: ADMIN
Delete / History Policy: set items / snapshots RESTRICT
Important Notes: Event 화면은 snapshot을 본다.

## preparation_set_items

Purpose: 템플릿 구성 라인.
Primary Key: `id`
Main Foreign Keys: `preparation_set_id` CASCADE, `preparation_item_id` RESTRICT
Key Fields: `planned_quantity`, `sort_order`
Important Constraints: UNIQUE (set, item); qty >= 1
Write Authority: `prep-admin` add/update/remove-set-item (ADMIN)
Delete / History Policy: 세트 삭제 시 CASCADE. 적용 후 Event snapshot과 독립
Important Notes: apply 시 수량/이름이 snapshot으로 copy.

## preparation_sets

Purpose: 재사용 준비 템플릿.
Primary Key: `id`
Main Foreign Keys: `created_by`
Key Fields: `name`, `is_active`
Important Constraints: name not blank
Write Authority: `prep-admin` upsert-set / apply-set (ADMIN). SELECT: ADMIN
Delete / History Policy: 적용된 plan의 source FK는 RESTRICT
Important Notes: 적용 = copy. 이후 템플릿 수정 ≠ Event 자동 변경.

## product_attribute_values

Purpose: Product×속성 값.
Primary Key: `id`
Main Foreign Keys: `product_id`, `attribute_definition_id`
Key Fields: `value_text`, `value_number`, `value_boolean`, `option_value`
Important Constraints: UNIQUE (`product_id`, `attribute_definition_id`)
Write Authority: `product-admin` set-attribute (ADMIN)
Delete / History Policy: product/definition RESTRICT
Important Notes: Variant가 아니라 Product 수준.

## product_categories

Purpose: 카테고리 트리.
Primary Key: `id`
Main Foreign Keys: `parent_id` → self RESTRICT
Key Fields: `code`, `name`, `is_active`
Important Constraints: UNIQUE `code`; parent ≠ self
Write Authority: `product-admin` masters (ADMIN). SELECT: `has_app_access`
Delete / History Policy: 자식/상품/rule RESTRICT
Important Notes: Assortment rule `include_descendants`.

## product_images

Purpose: 상품 이미지 메타. 바이트는 `product-images`.
Primary Key: `id`
Main Foreign Keys: `product_id` RESTRICT; `uploaded_by` SET NULL
Key Fields: `storage_path`, `image_type` (front, back, pattern, package, other), `is_primary`
Important Constraints: UNIQUE `storage_path`; 상품당 primary 1개 (partial unique)
Write Authority: `product-admin` sign/complete/set-primary/delete (ADMIN)
Delete / History Policy: 메타 + Storage (ADMIN)
Important Notes: SELECT 메타는 `has_app_access`.

## product_tags

Purpose: Product–Tag 조인.
Primary Key: `(product_id, tag_id)`
Main Foreign Keys: 두 컬럼 모두 RESTRICT
Key Fields: PK only
Important Constraints: composite PK
Write Authority: `product-admin` add/remove-tag (ADMIN)
Delete / History Policy: 조인 행 삭제
Important Notes: Assortment tag 필터의 대상.

## product_variants

Purpose: 실제 **SKU**. 재고·이동의 단위. (발주 테이블은 현재 없음)
Primary Key: `id`
Main Foreign Keys: `product_id` RESTRICT; optional `size_id`, `primary_color_id`
Key Fields: `sku_code` UNIQUE, `is_active`
Important Constraints: sku_code not blank
Write Authority: `product-admin` add/update-variant (ADMIN). SELECT: `has_app_access`
Delete / History Policy: assortment/inventory FKs RESTRICT
Important Notes: Product 공통정보와 분리. Event Snapshot은 `sku_code_snapshot`을 복사한다.

## products

Purpose: 판매 상품 공통정보.
Primary Key: `id`
Main Foreign Keys: optional `primary_category_id` SET NULL; `created_by` SET NULL
Key Fields: `product_code` UNIQUE, `name`, `default_pack_quantity`, `purchase_price`, `sale_price`, `country_of_origin` (KR, CN, JP, OTHER), `is_active`
Important Constraints: code/name not blank; pack > 0; prices NULL or >= 0
Write Authority: `product-admin` create/update (ADMIN). list/get Edge는 app access. SELECT RLS: `has_app_access`. UI 상품화면은 ADMIN
Delete / History Policy: variants/images/tags RESTRICT
Important Notes: 팩입수 기본값은 Check item `pack_size_snapshot`의 소스. 재고 수량은 여기 없음.

## profiles

Purpose: 앱 사용자 프로필. Auth 세션만으로는 업무 접근이 없다.
Primary Key: `id` (= `auth.users.id`, ON DELETE CASCADE)
Main Foreign Keys: `id` → `auth.users`
Key Fields: `role` (ADMIN, STAFF, PART_TIMER), `display_name`, `phone` (E.164), `is_master`, `is_active`, `login_allowed_from`, `login_allowed_until`
Important Constraints: unique phone; unique `is_master` WHERE true; MASTER ⇒ role ADMIN; phone length >= 10
Write Authority: `user-admin` (ADMIN) + `invite-accept`. 클라이언트 테이블 쓰기 없음. MASTER 역할/비활성/삭제는 `protect_master_profile`이 service_role 외 거부
Delete / History Policy: Auth user 삭제 시 CASCADE. MASTER 삭제는 service_role만
Important Notes: `has_app_access` = active AND login window. `is_admin_user`는 그 창이 열린 ADMIN. 배정 동료 SELECT 정책 있음. 로그인 이메일은 전화 기반 synthetic.

## sizes

Purpose: 사이즈 마스터.
Primary Key: `id`
Main Foreign Keys: none
Key Fields: `code`, `display_name`, `is_active`
Important Constraints: UNIQUE `code`
Write Authority: `product-admin` masters (ADMIN). SELECT: `has_app_access`
Delete / History Policy: variant/rule RESTRICT
Important Notes: Variant `size_id` nullable.

## tags

Purpose: 상품 태그 마스터.
Primary Key: `id`
Main Foreign Keys: none
Key Fields: `name`, `is_active`
Important Constraints: UNIQUE `name`; name not blank
Write Authority: `product-admin` (ADMIN). SELECT: `has_app_access`
Delete / History Policy: product_tags / assortment rules RESTRICT
Important Notes: Assortment rule 필터로 사용.
