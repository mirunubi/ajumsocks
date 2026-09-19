# Phase 8 Event Finance Plan

상태: **구현 기준**

상위 문서: `docs/00_MASTER_PLAN.md`
선행: Phase 0–7
충돌 시 MASTER PLAN을 우선한다.

한글 상호: **아점양말 (아점삭스)**

보충요청 / 발주 / 입고는 이 문서 범위가 아니다.

---

# 1. 목적

행사 운영자가 **대략 얼마를 벌었고 얼마가 남았는지** 빠르게 본다. 회계 ERP가 아니다.

총매출 − 예상 상품원가 − 행사지출 − 매대수수료 − 입점비 = **예상 순이익**.  
UI에 `예상`을 명시한다. SKU 판매량 × 매입단가 자동원가는 만들지 않는다.

---

# 2. 테이블

## `event_daily_sales`

UNIQUE `(event_id, business_date)`. 금액 `numeric(14,0) >= 0`.  
합계는 저장하지 않고 `card + cash + other`로 계산.

row 없음 = 미입력. row 있고 전부 0 = 0원 확인.

`business_date`는 KST `date`. 행사 시작~종료(KST 날짜) 밖은 거부.

## `expense_categories`

code unique. 초기 FOOD/PARKING/TRANSPORT/LODGING/DELIVERY/SUPPLIES/LABOR/OTHER.  
ADMIN만 관리. 삭제는 비활성화.

## `event_expenses`

날짜는 행사기간 밖 허용. `payment_method` CARD/CASH/OTHER.  
물리삭제 없음. `voided_at` 있으면 손익 제외. void는 ADMIN만.

## `event_expense_receipts`

metadata only. Bucket `expense-receipts`, path `{event_id}/{expense_id}/{uuid}_{filename}`.  
Storage 먼저 삭제 후 DB. ADMIN 삭제.

## `event_financial_inputs`

PK `event_id`. `estimated_product_cost` NULL = 미입력, 0 = 0원 확인. ADMIN only.

## `audit_logs`

매출 생성/수정, 지출 생성/수정/void, 상품원가 수정.  
INSERT는 SECURITY DEFINER RPC만. SELECT는 ADMIN.

계약 필드(`contract_type` / `commission_rate` / `fixed_fee`)는 `events` 재사용. 중복 컬럼 없음.

---

# 3. 계산 (서버 Source of Truth)

수수료 KRW 1원 `round()`.

| 계약 | 수수료 | 입점비 |
|---|---|---|
| NONE | 0 | 0 |
| COMMISSION | 총매출 × rate / 100 | 0 |
| FIXED_FEE | 0 | fixed_fee |
| MIXED | 총매출 × rate / 100 | fixed_fee |

원가 NULL이면 순이익 숫자를 확정값처럼 보여주지 않음 (`손익 계산 미완료`).

Summary는 View 중복저장 없이 RPC `event_finance_summary`가 원본에서 계산.

행사 status를 SETTLED로 자동 변경하지 않음.

---

# 4. 권한 / Write

Edge `event-finance` + Secret. 변경과 Audit은 같은 RPC Transaction.

* 매출/지출: ADMIN 전체, 배정 STAFF/PART_TIMER는 해당 행사. `updated_at` optimistic concurrency.
* 상품원가 / 수수료·입점비 상세 / 예상 순이익 / Audit: ADMIN only. API에서도 숨김. UI 숨김만 쓰지 않음.
* RLS: sales/expenses `can_read_event`; financial_inputs / audit_logs `is_admin_user`.
* `has_app_access()` 유지.

---

# 5. UI

행사 상세: 매출 / 지출 / 손익. 모바일 숫자 키패드, 천 단위, 영수증 카메라.  
0원 입력일은 `입력완료 · 0원`. 행사기간 밖 지출은 참고 표시.  
ADMIN 홈: 오늘 진행행사 매출 입력여부. 복잡한 BI 없음.

충돌 시: `다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 확인하세요.`

---

# 6. 하지 않을 것

재고 차감, 판매수량 추론, POS/VAN, 자동 COGS, 발주/입고/송장.

---

# 7. Extension Point

향후 보충요청 → Location 재고 우선 → 발주 → 배송 → Position.  
Phase 8 매출 금액과 재고는 독립으로 둔다.

---

# 8. MASTER PLAN / Phase 0–7 충돌 검토

| 항목 | 결과 |
|---|---|
| events 계약 필드 재사용 | 유지 |
| 수량/재고와 매출 분리 | 유지 |
| Write = Edge + RPC | `event-finance` |
| Secret 브라우저 금지 | 유지 |
| SETTLED 자동 변경 없음 | 유지 |
| 발주 아직 없음 | 유지 |

충돌 없음.
