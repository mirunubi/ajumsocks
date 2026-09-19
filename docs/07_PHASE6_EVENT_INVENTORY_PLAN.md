# Phase 6 Event Inventory Check Plan

상태: **구현 기준**

상위 문서: `docs/00_MASTER_PLAN.md`
선행: Phase 0–5
충돌 시 MASTER PLAN을 우선한다.

한글 상호: **아점양말 (아점삭스)**

Phase 7 재고이동은 이 문서 범위가 아니다.

---

# 1. 목적

행사 상품구성에 확정된 SKU만 대상으로, 완전 묶음 + 개봉 잔량 단계로 **근사 현장재고**를 남긴다.

정밀 ERP가 아니다. 2~3개 오차는 정상이다. 판매량으로 추론하지 않는다.

---

# 2. 실사 대상

`event_assortment_items` where `removed_at IS NULL`.

Product Master 전체를 돌지 않는다. Check 시작 시 이 목록을 Item으로 복사해 고정한다. 중간에 구성에 SKU가 추가되어도 진행 중 Check 대상은 바뀌지 않는다.

---

# 3. 근사 표현

입력:

* `full_pack_count` ≥ 0 정수 (완전한 묶음)
* `remainder_level` code

| code | UI | 대표값 |
|---|---|---|
| ZERO | 0 | 0 |
| VERY_LOW | 1~2 | 2 |
| HALF | 약 5 | 5 |
| HIGH | 약 7~8 | 8 |
| FULL | 약 10 | 10 |

추정값 = `full_pack_count * pack_size_snapshot + 대표값`. **저장하지 않고 계산한다.**

표시: `2묶음 + 약 5` / `약 25개`.

pack_size는 Check 시작 시 Product `default_pack_quantity`를 snapshot. 기본 운영은 10. 범용 포장엔진은 만들지 않는다.

## 미입력 ≠ ZERO

둘 다 NULL = 미입력 (아직 확인 안 함).  
`0 + ZERO` = 현장에서 없음으로 확인.

NULL을 ZERO로 바꾸지 않는다.

---

# 4. 테이블

## `event_inventory_checks`

event_id, check_kind (`OPENING`/`ROUTINE`/`CLOSING`), check_scope (`FULL`/`PARTIAL`), status (`DRAFT`/`CONFIRMED`/`CANCELLED`), started_at/by, confirmed_at/by, memo.

물리삭제 없음.

## `event_inventory_check_items`

check 시작 시 대상 SKU 전부 INSERT. `full_pack_count`/`remainder_level`는 NULL로 시작.

UNIQUE `(inventory_check_id, product_variant_id)`.

둘 다 NULL이거나 둘 다 NOT NULL.

## `event_inventory_current`

UNIQUE `(event_id, product_variant_id)`.

**CONFIRMED Check의 입력된 SKU만** upsert. `first_recognized_at`은 insert 시만.

DRAFT/CANCELLED는 Current에 영향 없음.

---

# 5. FULL / PARTIAL

**FULL**: Confirm 전 모든 Check Item 입력 필수. 미입력이 있으면 `incomplete_full_check`.

**PARTIAL**: 입력된 SKU만 Current 갱신. 미입력 SKU의 Current는 유지. 입력 0건 Confirm은 거부.

둘 다 Phase 6에서 지원한다.

---

# 6. Confirm Transaction

RPC `public.confirm_event_inventory_check` SECURITY DEFINER.

1. row lock
2. 이미 CONFIRMED → `already_confirmed` (409, 재고 이중반영 없음)
3. DRAFT가 아니면 거부
4. FULL 미입력 검사 / PARTIAL 1건 이상
5. 입력된 Item만 Current upsert
6. status=CONFIRMED, confirmed_at/by

Header만 확정되고 Current가 빠지는 상태를 허용하지 않는다.

CONFIRMED Check는 Edge에서 save/cancel 거부. 수정은 새 ROUTINE Check.

---

# 7. 최초 인정 / 이력

출고 원장을 고치지 않는다. 첫 CONFIRMED Current가 현장 Baseline.

두 번째 Confirm은 Current만 갱신. 이전 Check Item은 불변.

---

# 8. 권한 / Write

조회·실사 입력: `has_app_access()` + `can_read_event` (ADMIN 또는 배정).

행사 status는 자동 변경하지 않는다.

Write는 Edge Function `event-inventory` + Secret. Client SQL Write 없음.

`can_write_event`(ADMIN only)를 실사 입력에 쓰지 않는다. 현장 STAFF/PART_TIMER가 입력해야 한다.

동시성: Item `updated_at` optimistic. WebSocket 없음.

---

# 9. 화면

행사 상세 `재고`: Current (사진/이름/SKU/Size/Color/약 N개/최근 시각), 실사 시작, 이력.

`/events/:eventId/inventory/:checkId`: 모바일 입력. ± 묶음, 잔량 칩, 이전값/차이(`약 -7`, 판매 아님), 검색/필터/미입력만, 그룹 접기.

DRAFT 재접속 가능.

---

# 10. Phase 7 Extension Point

`event_id` + `product_variant_id` + Current/Check History를 유지한다.

Location/Movement는 Phase 7. CLOSING Current를 이동 Baseline으로 쓸 수 있게만 둔다.

---

# 11. MASTER PLAN / Phase 0–5 충돌 검토

| 항목 | 결과 |
|---|---|
| 출고/이동/본사재고 없음 | 유지 |
| 실사 대상 = 행사 확정 SKU | Phase 5 Snapshot 사용 |
| 수량 컬럼을 assortment에 추가하지 않음 | 별도 inventory 테이블 |
| Write = Edge + RPC 트랜잭션 | `event-inventory` |
| 알바 입력 | 배정 + has_app_access |
| 준비물/상품구성과 테이블 분리 | 유지 |

충돌 없음.
