# Phase 7 Inventory Location / Movement Plan

상태: **구현 기준**

상위 문서: `docs/00_MASTER_PLAN.md`
선행: Phase 0–6
충돌 시 MASTER PLAN을 우선한다.

한글 상호: **아점양말 (아점삭스)**

Phase 8 매출/지출/손익 및 발주는 이 문서 범위가 아니다.

---

# 1. 목적

이미 보유한 양말의 **위치 이동**만 관리한다.

본사를 거치지 않는 행사→행사, 임시/제3장소, 한 Source의 여러 목적지 분배, 여러 Source의 한 행사 합류를 지원한다.

택배/송장/발주/매출은 만들지 않는다.

---

# 2. Physical vs Operational

| 개념 | 저장 | 의미 |
|---|---|---|
| Physical Recognition | `event_inventory_current` + Check History | 사람이 눈으로 확인한 현장 인정재고 |
| Operational Estimate | `inventory_positions.estimated_units` | 마지막 실사/보정 이후 Movement를 반영한 운영 예상 |

Phase 6 Check History는 이동 때문에 수정하지 않는다.

새 Check CONFIRM은 Physical과 해당 EVENT Position을 **같은 실사 대표값으로 재기준화**한다. 과거 Movement는 남는다.

---

# 3. 근사 수량

입력은 Phase 6와 동일: `full_pack_count` + `remainder_level` (ZERO/VERY_LOW/HALF/HIGH/FULL).

대표값 0/2/5/8/10. UI는 `약 N개`.

**Movement Item**에는 계산된 `sent_estimated_units` / `received_estimated_units`를 저장한다.  
목적: Source 차감, Destination 증가, 발송-수령 차이, 이력. Drift 방지를 위해 입력 쌍에서 계산하고 그 값을 확정 시 사용한다.

Check Item에는 계속 추정값을 저장하지 않는다 (Phase 6 유지).

---

# 4. Locations

`inventory_locations`: HQ / EVENT / TEMP / THIRD_PARTY.

* 활성 HQ는 1개. UNIQUE `(location_type) WHERE location_type = 'HQ'`.
* EVENT는 Event 1:1. UNIQUE `event_id WHERE location_type = 'EVENT'`.
* `event_id`는 EVENT일 때만 NOT NULL. 사용자가 Event를 재연결할 수 없다.
* 행사 INSERT 트리거로 Location 자동 생성. 기존 행사는 Migration에서 backfill.
* TEMP/THIRD_PARTY는 ADMIN 생성. 배송 기능 아님.

UI: `재고 위치`.

---

# 5. Positions

`inventory_positions` UNIQUE `(location_id, product_variant_id)`.

`estimated_units >= 0`. 음수 금지.

EVENT 초기값: CONFIRMED Check 대표값. Migration은 기존 `event_inventory_current`를 EVENT Position으로 채운다.

`confirm_event_inventory_check`를 확장해 Current upsert와 같은 트랜잭션에서 EVENT Position을 맞춘다.

---

# 6. Adjustments

`inventory_adjustments`: 과거 Position을 직접 덮어쓰기만 하지 않고 before/after를 남긴다.

UI: `현재 재고로 맞추기`. ADMIN만. 행사 현장은 Check를 우선한다.

---

# 7. Movements

Header `inventory_movements`: DRAFT → DISPATCHED → RECEIVED. DRAFT만 CANCELLED.

번호: `MV-YYYYMMDD-0001` (KST 일자, 일별 일련). UUID와 별개, UNIQUE.

Source ≠ Destination.

Item UNIQUE `(movement_id, product_variant_id)`. sent / received 분리. 차이를 분실/판매로 추론하지 않는다.

* DRAFT: Position 영향 없음. 수정 가능.
* DISPATCH: Transaction. Source Position에서 sent 차감. 이중 DISPATCH → `already_dispatched` 409.
* RECEIVE: Transaction. Destination에 received 증가. 이중 RECEIVE → `already_received` 409.
* DRAFT Cancel: Position 없음.
* DISPATCHED 일반 Cancel 금지. 되돌림은 향후 반대 Movement.

Source Position 없음/부족: `insufficient_stock`. 먼저 Check 또는 `현재 재고로 맞추기`.

Destination EVENT: 활성 assortment에 없는 SKU는 생성/DISPATCH 거부. Source EVENT는 assortment에서 빠져도 Position이 있으면 출고 가능.

---

# 8. 종료재고 분배

CONFIRMED CLOSING Check 기준 `남은 재고 보내기`.

Preview: 현재 Position, DRAFT 배정량, 추가 이동 가능량.

Category 일괄 목적지 → Source-Destination별 DRAFT Movement 분리 생성. `source_event_inventory_check_id` 연결.

한 SKU의 수량 분할은 별도 Movement에 직접 입력. 자동분할 엔진 없음.

최종 하드 검증은 DISPATCH 시 Position.

---

# 9. 권한 / Write

Write: Edge `inventory-movement` + Secret. Client SQL Write 없음.

* ADMIN: Location/Adjustment/Movement 전체.
* 배정 STAFF/PART_TIMER: 배정 행사가 Source면 출발 확인, Destination이면 도착 확인. 생성/본사 조작/미배정 조회 불가.
* READ Movement: ADMIN 전체, 그 외 Source 또는 Destination EVENT가 배정 행사일 때만.
* `has_app_access()` 유지.

---

# 10. UI

* ADMIN `재고 위치` / Location별 예상재고 + 맞추기.
* `재고 보내기` 목록/작성/출발/도착. `발송량과 동일`.
* 행사 재고: 최근 실사 vs 현재 예상, 이후 출고 요약.
* CLOSING 확정 후 Category 일괄 목적지.

용어: 재고 보내기 / 출발 확인 / 도착 확인 / 현재 재고로 맞추기 / 재고 위치.

---

# 11. RPC

* `ensure` EVENT Location (trigger)
* `confirm_event_inventory_check` 확장 (Position 동기화)
* `dispatch_inventory_movement`
* `receive_inventory_movement`
* `apply_inventory_adjustment`
* `create_closing_movements`

service_role only.

---

# 12. Phase 8 Extension Point

보충요청 → 기존 Location 우선 → 부족분 발주 → 배송 → 수령 → Position.  
Phase 7 Movement 위에 연결한다. 이 Phase에서 발주 테이블을 만들지 않는다.

---

# 13. MASTER PLAN / Phase 0–6 충돌 검토

| 항목 | 결과 |
|---|---|
| 발주/택배/매출 아직 없음 | 유지 |
| Phase 6 Check History 불변 | 유지. Position만 재기준 |
| assortment에 수량 컬럼 없음 | 유지 |
| Write = Edge + Transaction RPC | `inventory-movement` |
| 근사재고 / 미입력≠ZERO | Movement는 입력 필수 쌍 |
| EVENT Location ↔ events.id | Phase 2 event FK |
| 알바는 배정 행사만 | dispatch/receive만 |

충돌 없음.
