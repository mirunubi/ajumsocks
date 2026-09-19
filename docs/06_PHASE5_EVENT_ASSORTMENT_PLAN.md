# Phase 5 Event Assortment Plan

상태: **구현 기준**

상위 문서: `docs/00_MASTER_PLAN.md`
선행: Phase 0–4
충돌 시 MASTER PLAN을 우선한다.

한글 상호: **아점양말 (아점삭스)**

Phase 6 재고는 이 문서 범위가 아니다.

---

# 1. 목적

행사마다 다른 **취급 SKU 범위**를 세트(Template)로 만들고 행사 Snapshot으로 고정한다.

수량은 다루지 않는다. 출고·재고·발주·입고 컬럼을 넣지 않는다.

---

# 2. Template ≠ Snapshot

```text
assortment_sets + assortment_set_rules   Template (Rule 필터)
        ↓ apply (한 트랜잭션)
event_assortments + event_assortment_items   Snapshot
```

적용 이후 Template / Product / Category / Tag / 신규 SKU 변경이 과거 행사를 자동 갱신하지 않는다.

표시 기본값은 Snapshot 컬럼이다. live Product 이름을 덮어쓰지 않는다.

---

# 3. 테이블

준비물(`preparation_*`)과 테이블·함수·UI를 섞지 않는다.

## 3.1 `assortment_sets`

id, name, description, is_active, created_by, timestamps.  
물리 DELETE 없음. `is_active=false`.

## 3.2 `assortment_set_rules`

한 Rule의 지정 조건은 **AND**. 여러 Rule은 **OR**.

nullable: category_id, tag_id, size_id, color_id, product_id, product_variant_id  
`include_descendants` default true  
최소 1개 필터 필수. SQL/JSON Logic 엔진 없음.

Template Rule은 물리 삭제 가능. Snapshot `source_rule_id`는 `ON DELETE SET NULL`.

## 3.3 `event_assortments`

행사당 1개. `event_id` UNIQUE.  
이미 있으면 재적용 거부 `assortment_exists`. 자동 overwrite UI 없음.

## 3.4 `event_assortment_items`

SKU Snapshot. `event_id`를 denormalize해 `can_read_event` RLS에 쓴다.

UNIQUE `(event_assortment_id, product_variant_id)` — 제외 후 재추가는 `removed_at` 해제.

`source_type`: `TEMPLATE` | `MANUAL`

수량 컬럼 금지.

---

# 4. Rule 평가

활성 Product + 활성 SKU만 Preview/적용 후보.

지정된 필드만 AND:

* category: exact, 또는 descendants (include_descendants)
* tag: product_tags
* size / color: variant
* product_id: 해당 상품의 활성 SKU 전부
* product_variant_id: 그 SKU만

비활성 SKU는 후보에서 제외. 이미 Snapshot에 있는 SKU는 이후 비활성화되어도 남는다.

---

# 5. 적용 트랜잭션

Edge Function이 Rule을 평가한 뒤 `public.apply_event_assortment(...)` SECURITY DEFINER RPC를 **한 번** 호출한다.

함수 안에서 Header INSERT + Items INSERT. 실패 시 전부 rollback.

Phase 3처럼 Header만 남기는 compensate delete를 쓰지 않는다.

이미 구성이 있으면 `assortment_exists`.

---

# 6. 수동추가 / 제외

ADMIN: `product_variant_id`로 MANUAL 추가. 중복 409. 제외된 동일 SKU는 restore.

제외: `removed_at`. 기본 목록·향후 실사 대상에서 빠진다. 행은 남긴다.

Header가 없으면 수동추가 시 source_set=null Header를 만들 수 있다.

---

# 7. RLS / Write

Set/Rule SELECT: `is_admin_user()`  
행사 Snapshot SELECT: `can_read_event(event_id)`  
Write: Edge `assortment-admin` + Secret Key, ADMIN만.

기존 private helper 재사용.

---

# 8. 화면

`/assortment-sets` 목록·생성  
`/assortment-sets/:id` Rule 편집 + Preview (건수 + 그룹 목록)

행사 상세 `상품구성`:

* 미적용: 세트 선택 → Preview → 확정
* 적용됨: 건수, Category 그룹 접기, 검색, Size 필터, 수동추가, 제외
* 재고수량 표시 없음
* 200+ SKU를 단일 긴 목록으로만 그리지 않음

---

# 9. Phase 6 Extension Point

실사 대상 = `event_assortment_items` where `removed_at is null`, 기준 `product_variant_id`.

수량 테이블은 Phase 6에서 Snapshot 행에 붙인다. Phase 5 Schema를 수량 컬럼으로 확장하지 않는다.

---

# 10. MASTER PLAN / Phase 0–4 충돌 검토

| 항목 | 결과 |
|---|---|
| 재고/출고/발주 아직 없음 | 유지. 수량 컬럼 없음 |
| 준비물과 상품구성 분리 | 유지. `preparation_*` 재사용 안 함 |
| Template/Snapshot | Phase 3과 동일 원칙, 별도 테이블 |
| Product Master 변경 없음 | Rule이 Phase 4 Category/Tag/SKU를 읽기만 함 |
| Write = Edge Function | `assortment-admin` |
| Phase 4 문서의 “수량” 언급 | Phase 5에서 범위만. 수량은 Phase 6 |

충돌 없음.
