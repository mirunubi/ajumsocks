# Phase 3 Preparation Management Plan

상태: **구현 기준**

상위 문서: `docs/00_MASTER_PLAN.md`
선행: Phase 0 Auth, Phase 1 Users, Phase 2 Events
충돌 시 MASTER PLAN을 우선한다.

한글 상호: **아점양말 (아점삭스)**

Phase 4 상품/SKU/재고는 이 문서 범위가 아니다.

---

# 1. 목표

반복 외부행사의 **집기·소모품**을 템플릿으로 관리하고, 행사마다 Snapshot으로 복사한 뒤 준비/현장/회수를 체크한다.

판매양말(신생아/아동/성인 등)은 준비물에 넣지 않는다.

흐름:

```text
준비물 Master
  → 준비물 세트 (Template)
    → 행사에 적용 (Snapshot 복사)
      → 행사 전 준비확인
      → 현장 확인
      → 집기 회수확인
```

---

# 2. 핵심 원칙: Template ≠ Snapshot

세트를 행사에 적용하면 `preparation_set_items`를 **복사**한다.

이후 Template에서 랙 6→8로 바꿔도 이미 적용된 행사 Snapshot은 랙 6을 유지한다.

행사 화면은 `preparation_items`를 live join하지 않고 Snapshot 컬럼을 표시한다.

---

# 3. 종류

DB code / UI:

```text
EQUIPMENT   집기     기본 requires_return = true
CONSUMABLE  소모품   기본 requires_return = false
```

단위는 표시용 text다. 변환 엔진 없음. 예: 개, 세트, 박스, 롤, 묶음.

---

# 4. 테이블

계약/상품 테이블은 만들지 않는다. Template과 Snapshot만 분리한다.

## 4.1 public.preparation_items

Master. ADMIN만 쓰기. 물리 DELETE 없음. `is_active=false`.

과거 Snapshot의 `source_preparation_item_id` FK는 RESTRICT.

## 4.2 public.preparation_sets / preparation_set_items

Template. unique `(preparation_set_id, preparation_item_id)`.
`planned_quantity >= 1`.

세트 구성 행은 Template이므로 구성 변경 시 물리 삭제 가능.

## 4.3 public.event_preparation_plans

행사당 1개. `event_id` UNIQUE.

이미 plan이 있으면 **재적용 거부** (`plan_exists`). 자동 overwrite 없음.

## 4.4 public.event_preparation_items

Snapshot. `event_id` + `plan_id` 둘 다 둔다. RLS는 `can_read_event(event_id)` 재사용.

표시는 Snapshot 컬럼:

* item_name_snapshot
* item_type_snapshot
* unit_snapshot
* planned_quantity
* requires_return
* status
* memo

`removed_at` 이 있으면 체크리스트·진행률에서 제외. 물리 DELETE 없음.

### 행사 전용 추가 (단순안)

자유명 Custom SKU를 만들지 않는다.

행사에 항목을 더할 때는 **활성 Master 항목을 골라 Snapshot으로 복사**한다.
USB 연장케이블이 필요하면 Master에 한 번 등록한 뒤 해당 행사 Snapshot에 추가한다.

같은 `source_preparation_item_id`가 활성 행으로 이미 있으면 거부.
`removed_at` 된 같은 항목을 다시 추가하면 해당 행을 복구한다.

---

# 5. 상태

```text
NOT_READY  미확인
READY      준비완료
ON_SITE    현장확인
RETURNED   회수완료
```

Workflow Engine 없음. **순차 강제를 하지 않는다.**

허용:

* EQUIPMENT / `requires_return=true`: 네 상태 어디든 직접 지정
* CONSUMABLE / `requires_return=false`: `NOT_READY` `READY` `ON_SITE` 만. `RETURNED` 거부

현장 늦게 체크: 미확인 → 현장확인 가능.

---

# 6. 권한

| 작업 | ADMIN | 배정 STAFF/PART_TIMER | 미배정 |
|---|---|---|---|
| Master/세트 CRUD | O | X | X |
| 세트 적용, 행사 수량/추가/제외 | O | X | X |
| Snapshot 조회 | 전체 | 배정 행사만 | X |
| 상태 체크 | 전체 | 배정 행사만 | X |

쓰기는 Phase 2와 같이 **Edge Function + Secret Key**. 브라우저에 Secret 없음.
SELECT는 RLS. `private.can_read_event` / `private.is_admin_user` 재사용.

---

# 7. 진행률

활성 = `removed_at is null`

```text
준비완료  n / total     status in (READY, ON_SITE, RETURNED)
현장확인  n / total     status in (ON_SITE, RETURNED)
회수      returned / returnTarget
  returnTarget = requires_return = true 인 활성 행만
```

소모품은 회수 미완료로 세지 않는다.

---

# 8. Edge Function

`prep-admin` `verify_jwt = true`

```text
list-items, upsert-item
list-sets, upsert-set
add-set-item, update-set-item, remove-set-item
preview-apply, apply-set
get-event
update-event-item      # 수량/메모, ADMIN
add-event-item         # Master에서 복사, ADMIN
remove-event-item      # removed_at, ADMIN
set-status             # ADMIN 또는 배정 멤버
```

`apply-set`은 plan이 있으면 409. Preview는 복사 전 확인용.

---

# 9. 화면

| 경로 | 대상 |
|---|---|
| `/preparations` | ADMIN 준비물 Master |
| `/preparation-sets` | ADMIN 세트 목록 |
| `/preparation-sets/:id` | ADMIN 세트 구성 |
| `/events/:id` 준비물 Section | 배정자/ADMIN 체크, ADMIN 적용/수량 |

상세 상단 근처에 `12 / 18 준비완료` 요약.
상태 버튼은 큰 터치 영역.

Home:

* 본인(또는 ADMIN 전체) 행사 중 준비 미완료를 짧게 표시
* D-n 은 시작일 기준 계산. Push/SMS 없음

영구삭제 버튼 없음. Master는 비활성화.

---

# 10. Index / Constraint

* `preparation_items (is_active, sort_order)`
* `preparation_set_items unique (set, item)`
* `preparation_set_items planned_quantity >= 1`
* `event_preparation_plans unique (event_id)`
* `event_preparation_items (event_id, status)`
* `event_preparation_items planned_quantity >= 1`

---

# 11. MASTER PLAN / Phase 0–2 충돌 검토

| 항목 | 결과 |
|---|---|
| 판매상품을 준비물에 넣지 않음 | 유지. Phase 4 Extension |
| SQL Migration만 Schema 변경 | 새 파일만 추가 |
| RLS + private helper 재사용 | `can_read_event` 재사용, 중복 helper 없음 |
| Write는 Edge Function | `prep-admin` |
| Publishable만 브라우저 | 유지 |
| 행사 Snapshot이 Template에 묶이지 않음 | 복사 후 독립 |
| Phase 2 행사 상세에 빈 미래 탭 없음 | 준비물은 이번 Phase에서 Section 추가 |
| SMS/Push 없음 | 유지 |

충돌 없음.

---

# 12. Phase 4 Extension Point

* Product/SKU는 별도 테이블. `preparation_*` 를 상품에 재사용하지 않는다.
* 행사 상품구성 세트는 준비물 세트와 다른 Template이다.
* 재고 출고/이동은 Snapshot 수량과 연결하지 않은 채 둔다.
