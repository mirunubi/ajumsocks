# Decisions

Append-only record of **why** the current system is shaped this way.

Baseline (do not treat this file as a roadmap):

* commit `84e22cc` — event contract amount restriction
* Phase 0–7 ALL PASS, Phase 8 PASS, E2E PASS
* Phase 9 not started

This is not an ADR workflow. New entries are appended as `D-019` and later when a real implementation choice is made. Do not record unimplemented domains (Supplier, Purchase Order, Replenishment, Shipment, AI search, POS).

---

## D-001 Product와 SKU 분리

Decision:
판매 마스터는 `products`(공통 개념)와 `product_variants`(SKU)로 나눈다. 재고 Check / Position / Movement item은 Variant id를 가리킨다.

Why:
양말은 같은 상품에 사이즈·컬러가 있다. 공통 이름·카테고리·기본 팩입수와, 실제로 세고 옮기는 단위를 한 테이블에 넣으면 실사와 이동이 모호해진다.

Impact:
Assortment 규칙과 Event Snapshot도 Variant를 대상으로 한다. 현재 발주 테이블은 없다. 발주가 생기면 SKU 단위로 붙는 것이 기본 전제다.

---

## D-002 Preparation과 Product 분리

Decision:
준비물(`preparation_*`, Event Snapshot)은 행사 운영물품이다. Product/Variant는 판매재고다. 두 Domain을 한 마스터로 합치지 않는다.

Why:
집기·소모품과 판매 SKU는 실사 단위, 수량 의미, 손익 의미가 다르다. 섞으면 “준비 수량”과 “판매 재고”가 같은 숫자처럼 보인다.

Impact:
Preparation Edge (`prep-admin`)와 Product/Assortment/Inventory 경로는 분리되어 있다. 준비물 상태 변경은 재고 Position을 바꾸지 않는다.

---

## D-003 Template → Event Snapshot

Decision:
Preparation / Assortment는 Template을 행사에 적용할 때 Event Snapshot을 복사한다. 이후 Template 변경은 이미 만든 행사 Snapshot에 자동 반영되지 않는다. 같은 행사에 세트 재적용은 `UNIQUE event_id`로 거부된다.

Why:
행사 당일 준비 목록과 취급 SKU는 그 시점의 운영 사실이다. 템플릿을 고친다고 지난 행사 기록이 바뀌면 현장과 이력이 어긋난다.

Impact:
UI는 Snapshot 컬럼을 읽는다. Template을 기존 행사에 다시 덮어쓰려면 명시적인 새 설계결정이 필요하다.

---

## D-004 Assortment에는 수량 없음

Decision:
Assortment는 “이 행사에서 무엇을 판매하는가”(SKU 범위)만 정의한다. 수량 컬럼이 없다.

Why:
취급 범위와 보유 수량은 다른 질문이다. 수량까지 Assortment에 넣으면 Inventory Check와 이중 원장이 된다.

Impact:
실사 대상 SKU는 Event Assortment Snapshot에서 만든다. “얼마나 있는가”는 Inventory에서만 관리한다.

---

## D-005 근사재고 사용

Decision:
낱개 정밀재고를 강제하지 않는다. 실사·이동은 완전 묶음(`full_pack_count`)과 잔량 Level(`remainder_level`)을 저장한다. 대표수량(`estimated_units`)은 midpoint로 계산한 근사값이다.

Why:
현장 양말 업무는 팩 단위와 남은 더미 감각이 실제 작업 방식이다. 정확한 낱개 강제는 입력을 막거나 거짓 정밀도를 만든다.

Impact:
손익·원가에 이 근사값을 정밀 COGS처럼 쓰지 않는다 (D-013). remainder `ZERO`는 확인된 빈 재고이지 “모름”이 아니다 (D-006).

---

## D-006 미입력과 ZERO 분리

Decision:
없음과 0을 같은 값으로 저장하지 않는다.

* Inventory Check item: pack/remainder NULL pair = 미실사. `remainder_level = ZERO` = 확인된 빈 재고.
* Daily sales: 해당일 row 없음 = 미입력. row가 있고 금액 0 = 확인된 0원.
* Product cost: `estimated_product_cost` NULL = 미입력 (`profit_ready` false). `0` = 확인된 0원.

Why:
“아직 안 셈”을 0으로 넣으면 재고·매출·원가가 끝난 것처럼 보인다.

Impact:
FULL check confirm은 모든 item이 값 쌍이어야 한다. 손익은 원가 NULL이면 완료로 표시하지 않는다.

---

## D-007 Confirmed Inventory Check 불변

Decision:
`CONFIRMED` Physical Check는 item을 수정하지 않는다. 오류가 있으면 새 Check를 생성한다. DRAFT만 저장·취소할 수 있다.

Why:
실사는 그 시각의 현장 확인이다. 과거 실사 row를 고치면 Current/Position 재기준화의 근거가 사라진다.

Impact:
Confirm RPC가 Current와 EVENT location Position을 갱신한다. 이후 수정 경로는 새 Check 또는 Adjustment다.

---

## D-008 Physical Current와 Operational Position 분리

Decision:

* `event_inventory_current` = 마지막 CONFIRMED physical check 결과. Movement/Adjustment를 적용하지 않는다.
* `inventory_positions` = 그 이후 DISPATCH/RECEIVE/Adjustment까지 반영한 운영 예상값.

Why:
“마지막에 눈으로 확인한 값”과 “그 뒤로 보내고 받은 뒤의 예상”을 한 컬럼에 두면 현장 실사와 이동 이력이 서로를 지운다.

Impact:
두 값을 같은 “현재고” UI/보고서로 합치지 않는다. Finance는 둘 다 읽지 않는다.

---

## D-009 실사가 Position을 재기준화

Decision:
Movement 이후 예상재고와 실제재고는 다를 수 있다. 새 Check를 confirm하면 그 확인값을 EVENT location Position의 새 기준으로 덮는다. 과거 Movement row는 삭제하지 않는다.

Why:
운영 예상은 틀릴 수 있다. 틀린 이유를 과거 출고 row를 고쳐서 맞추지 않고, 새로 확인한 사실을 기준으로 삼는다.

Impact:
`last_physical_check_id`가 Position에 남는다. 이력은 Movement/Adjustment/Check에 남고, Current는 최신 실사만 유지한다.

---

## D-010 Movement sent / received 분리

Decision:
발송량(`sent_*`)과 실제 수령량(`received_*`)을 따로 저장한다. 차이는 기록만 하고 분실·판매·오류로 자동 해석하지 않는다.

Why:
현장에서 보낸 팩과 받은 팩이 다른 일은 흔하다. 시스템이 원인을 추측하면 잘못된 재고·손익이 생긴다.

Impact:
DISPATCH는 source Position을 보낸 수량만큼 줄인다. RECEIVE는 dest Position을 받은 수량만큼 늘린다. 차액 자동조정 없음.

---

## D-011 Inventory Position 음수 금지

Decision:
`inventory_positions.estimated_units >= 0`. 예상재고보다 많이 출고해야 하면 과거 Movement를 수정하지 않는다. 새 실사 또는 Adjustment로 현재 기준을 맞춘 뒤 출고한다.

Why:
음수 예상재고는 “없는 것을 보냈다”는 거짓 정밀도다. 과거 출고를 고치면 D-018 이력이 깨진다.

Impact:
`dispatch_inventory_movement`는 부족하면 실패한다. 보정은 Adjustment(지정값 설정) 또는 새 Check confirm이다.

---

## D-012 Finance와 Inventory 독립

Decision:
매출 금액 입력이 재고를 자동 차감하지 않는다. Daily Sales / Expenses / Product Cost와 Inventory 테이블 사이에 FK가 없다.

Why:
현재 시스템에는 정확한 상품별 판매수량 Source가 없다. 근사재고 감소를 판매로 위장하지 않는다.

Impact:
손익은 금액·수동 원가·계약으로 계산한다. POS/SKU 판매수량이 생기기 전까지 이 원칙을 유지한다.

---

## D-013 상품원가는 ADMIN 수동 입력

Decision:
예상 상품원가(`event_financial_inputs.estimated_product_cost`)는 ADMIN이 행사 단위로 수동 입력한다. `상품별 판매수량 × 원가` 자동계산을 하지 않는다.

Why:
근사 팩 재고와 미연결 매출만으로 SKU COGS를 만들면 정밀 원가처럼 보인다.

Impact:
NULL이면 `profit_ready = false`. RLS와 Edge summary에서 STAFF에게 원가/손익 필드를 주지 않는다. 재고 Domain이 원가를 쓰지 않는다.

---

## D-014 Event 계약금액 ADMIN only

Decision:
배정 STAFF/PART_TIMER는 행사 **일반정보**를 읽을 수 있다. 경영 금액은 ADMIN만 본다.

* `events.commission_rate`, `events.fixed_fee`
* `estimated_product_cost`
* 예상 순이익 및 P&L 분해(수수료액, 입점비 등)
* Finance Audit

구현 (RLS 컬럼숨김이 아님):

* PostgreSQL RLS는 row-level이다. `can_read_event`가 배정 행을 열어 준다.
* `authenticated`의 `events` SELECT GRANT에서 `commission_rate` / `fixed_fee`를 뺀다. ADMIN Client도 Postgres role은 `authenticated`이므로 PostgREST로는 두 컬럼을 못 읽는다.
* ADMIN은 Edge `event-admin` (Secret Key) `get`/`create`/`update`로 금액을 읽고 쓴다.
* 비ADMIN `event-admin` `get`은 응답에서 해당 키를 제거한다.
* `event_financial_inputs` / `audit_logs` SELECT RLS는 ADMIN. `event-finance` summary는 비ADMIN에게 cost·commission·booth_fee·profit 필드를 빼서 돌려준다.
* `contract_type`은 금액이 아니라서 배정 SELECT에 남긴다.

Why:
현장 업무(언제·어디서·무엇을 파는지, 매출/지출 입력)와 계약·손익 경영정보를 같은 권한으로 두면 STAFF가 수수료율·입점비를 직접 조회할 수 있다.

Impact:
Event List는 `select *`를 쓰지 않고 GRANT된 컬럼만 요청한다. UI에서만 숨기는 방식은 보안 통제가 아니다.

---

## D-015 Public Signup 금지

Decision:
공개 Sign Up이 없다. 사용자는 ADMIN이 생성하고 초대로 비밀번호를 설정한다. `enable_signup = false`. 로그인 UX는 전화번호+비밀번호이며 Auth identity는 합성 이메일이다.

Why:
내부 운영 PWA다. 불특정 가입은 권한 경계 밖의 계정을 만든다.

Impact:
Sign Up 화면 없음. Hosted Dashboard signup은 로컬 config만으로 증명되지 않으므로 별도 확인이 필요하다 (`docs/OPERATIONS.md`).

---

## D-016 MASTER는 ADMIN + is_master

Decision:
`app_role` enum에 MASTER 값을 두지 않는다. MASTER = `role = ADMIN` AND `is_master = true`. 최대 1행. CHECK로 MASTER는 ADMIN이어야 한다.

Why:
별도 MASTER role은 권한 분기를 두 배로 만든다. 실제로는 “지우거나 강등하면 안 되는 ADMIN” 한 명이다.

Impact:
트리거 `private.protect_master_profile`이 비-`service_role`에서 MASTER 삭제·강등·`is_master` 변경을 막는다. Event `assignment_role`은 `profiles.role`과 다른 enum이다.

---

## D-017 Write는 Edge/RPC 중심

Decision:
브라우저 authenticated 역할은 public 업무 테이블에 **SELECT**만 가진다. 권한 검사와 Transaction이 필요한 Write는 Edge Function(Secret Key)과 `service_role`-only RPC로 한다.

Why:
Client가 직접 INSERT/UPDATE 하면 RLS만으로 복잡한 전이(실사 confirm, 출고, 손익)를 안전하게 묶기 어렵다. Secret Key는 Vite/Git에 두지 않는다.

Impact:
`AdminGuard`는 UI일 뿐 보안 경계가 아니다. 새 privileged write를 Client GRANT로 열지 않는 것이 기본이다.

---

## D-018 History 우선

Decision:
가능하면 과거 사실을 수정·삭제하지 않고 새 record로 남긴다.

* Inventory Check: CONFIRMED 불변, 오류는 새 Check
* Movement: DELETE 금지. DRAFT만 CANCELLED. DISPATCHED/RECEIVED는 상태 전이 외 불변
* Adjustment: Position을 지정값으로 맞추되 Movement 이력을 지우지 않음
* Finance: 지출은 void. Daily sales는 upsert+audit. 원가 변경은 audit. 물리 삭제로 손익을 맞추지 않음

Why:
현장 숫자는 나중에 틀린 것으로 밝혀진다. 과거 row를 고치면 “그때 무엇이 기록됐는지”를 잃는다.

Impact:
정정은 새 Check, Adjustment, 새 매출 저장, expense void, 원가 재입력이다. 자동으로 이력을 현재값에 맞춰 재작성하지 않는다.

---

## D-019 Event Organizer와 Supplier를 별도 Domain으로 관리

Decision:
행사 주최자/행사장 운영사는 `event_organizers`다. 일반적인 `vendors` 테이블을 만들지 않는다. 상품 도매사(Supplier)는 아직 없으며 Phase 9 이후에 별도 Domain으로 둔다. `products.wholesaler_name`은 그대로 둔다.

Why:
주최자(네이처플러스, 백화점, 축제)와 매입처는 계약·재고·발주 의미가 다르다. 한 vendor로 합치면 수수료 기본값과 매입 단가가 섞인다.

Impact:
Organizer 이름/색상은 앱 사용자가 읽어도 된다. 계약 기본값은 `event_organizer_terms`로 분리한다.

---

## D-020 Organizer Terms는 Event 생성 시 Snapshot

Decision:
`event_organizer_terms`는 새 행사 생성 편의용 Default다. 행사 저장 시 `events.contract_type` / `commission_rate` / `fixed_fee` / `contract_memo`에 복사한다. Organizer 기본값을 나중에 바꿔도 기존 행사 계약은 바꾸지 않는다. Organizer Contact도 `event_contacts`로 복사하며 이후 Master 변경은 기존 행사를 덮지 않는다.

Why:
행사 당시 계약과 담당자가 운영 사실이다. 주최자 마스터를 고친다고 지난 판교 행사 수수료가 바뀌면 Finance가 깨진다.

Impact:
Finance 계산은 계속 `events` 계약 컬럼만 본다. Terms SELECT는 ADMIN only.

---

## D-021 관리자/현장 로그인은 UI만 분리

Decision:
Auth Backend, `profiles`, role enum, login window, MASTER 보호를 둘로 나누지 않는다. `/admin/login`과 `/login`은 같은 `signInWithPassword`다. ADMIN 첫 화면은 `/admin` 월간 캘린더, STAFF/PART_TIMER는 `/my-events`.

Why:
권한 분기는 이미 `profiles.role`과 RLS에 있다. Auth를 두 개 만들면 초대·비밀번호·login window가 이중화된다.

Impact:
`AdminGuard`는 `/admin/login`으로 보낸다. STAFF가 관리자 로그인 화면에서 성공하면 세션을 종료한다.

---

## D-022 Schedule Commitment와 Event Lifecycle 분리

Decision:
`events.status`는 PREPARING / ACTIVE / ENDED / SETTLED / CANCELLED만 쓴다. 일정 확정은 별도 `events.schedule_status` (TENTATIVE / CONFIRMED)다. TENTATIVE/CONFIRMED를 `event_status` enum에 넣지 않는다.

Why:
준비중·진행중은 운영 단계이고, 예정·확정은 캘린더 약속이다. 한 enum에 섞으면 “예정인데 ACTIVE” 같은 상태를 표현할 수 없다.

Impact:
Calendar는 TENTATIVE를 회색/점선/`예정` badge로 그린다. CONFIRMED만 Organizer 색 카드를 쓴다. 기존 행사는 마이그레이션에서 CONFIRMED, 신규 생성 기본값은 TENTATIVE.

---

## D-023 Setup 원본시간과 관리자 보정시간 분리

Decision:
도착/완료 원본은 `arrival_recorded_at` / `completed_recorded_at` / photo `recorded_at`이며 서버 `now()`다. 트리거가 한 번 찍힌 raw 값을 막는다. ADMIN 보정은 `adjusted_*` + `adjustment_reason`이고 `audit_logs` entity `SETUP_SESSION`에 남긴다.

Why:
현장 사진은 증거다. 휴대폰 시각이나 나중에 원본을 고치면 AI와 분쟁 대응에 쓸 raw가 사라진다. 보정은 설명 가능한 별도 값이어야 한다.

Impact:
Effective time = adjusted ?? raw. 세팅 소요분은 effective completed − arrival. STAFF/PART_TIMER는 raw·adjusted를 고치지 못한다.

---

## D-024 Inventory Location과 Operation Location 분리

Decision:
재고 장소는 `inventory_locations`다. 사람/짐 반복 거점은 `operation_locations`다. 행사장은 Master로 복제하지 않고 `events.venue_name` / `address`를 쓴다.

Why:
창고 재고 위치와 “사당집·부산숙소”는 질문이 다르다. 한 location 테이블에 넣으면 재고 Position과 이동 거점이 섞인다.

Impact:
Transition leg는 event XOR operation location endpoint다. 거점 비활성화는 과거 이동 다리를 지우지 않는다.

---

## D-025 AI 추천 전에 Raw Operation Data 축적

Decision:
세팅 시간·필요 인원·이동 시간 예측 UI/모델은 구현하지 않는다. 그 전에 계획/실제 물량, 인원, raw/adjusted 시각, 이동 구간을 구조화해 저장한다. 지도 API·자동 거리/시간 계산·GPS는 없다.

Why:
추천은 입력이 없으면 추측이 된다. 이번 범위는 운영 사실을 남기는 것이다.

Impact:
`event-ops`는 CRUD와 증빙만 한다. Summary(테이블 수, 전면 m, rack 단수)는 저장 컬럼이 아니라 계산값이다.

---

## D-026 Setup 물량과 물리치수는 Event별 Snapshot으로 보존

Decision:
설치 집기는 `event_setup_fixtures`에 `name_snapshot`과 mm 정수를 둔다. optional `preparation_item_id`로 준비 마스터와 연결할 수 있지만, Preparation 크기를 바꿔도 과거 설치 기록은 바뀌지 않는다.

Why:
“1800 테이블을 준비”와 “이 행사에 1800×750 테이블 4개를 설치”는 다른 사실이다. 마스터를 고친다고 지난 판교 전면길이가 바뀌면 학습 데이터가 오염된다.

Impact:
Preparation Domain을 합치지 않는다. 전면길이는 `(frontage_mm_per_unit ?? width_mm) × quantity`. 계획 수량과 실제 수량을 같이 남긴다.

