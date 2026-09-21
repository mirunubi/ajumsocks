# Pilot Rehearsal

Web MVP로 행사 한 건을 처음부터 끝까지 운영해 보고, 실제 Pilot 운영절차와 체크리스트를 확정한 기록이다.

이번 단계는 Feature 개발이 아니다. 새 Domain, Supplier, PO, Phase 9, Native App, 대규모 UI/Schema 변경은 하지 않았다. 리허설 중 발견한 문제는 즉시 고치지 않고 아래 Issue Log에 분류했다.

실제 외부 행사를 이 문서로 “시작했다”고 기록하지 않는다. `docs/MVP_ROADMAP.md`의 **Real Event Pilot = NEXT**를 유지한다.

---

## Baseline

| Field | Value |
| --- | --- |
| Feature baseline | `fd66f7e` (`fix: close web MVP pilot gaps`) |
| Rehearsal date | 2026-09-21 |
| Environment | local Supabase `ajumsocks` + Vite `http://127.0.0.1:5173` |
| Phase 9 | NOT STARTED |
| Real Event Pilot | NEXT |
| Go/No-Go | **GO FOR REAL PILOT** |

사전 Gap Check: P0 = 0, P1 = 0, MISSING = 0, Pilot Readiness = READY FOR PILOT (`docs/MVP_GAP_CHECK.md`).

---

## Rehearsal event

테스트 데이터만 사용했다. 실제 개인/업체 민감정보는 넣지 않았다.

| Field | Value |
| --- | --- |
| 행사명 | 가을 양말 행사 Pilot |
| 행사장 | 롯데백화점 판교점 |
| 주소 | 경기도 성남시 분당구 판교역로 166 1층 |
| 주최 | 네이처플러스 |
| 기간 | 2026-09-21 10:30 ~ 2026-09-25 20:00 (KST) |
| 계약 | COMMISSION 18% |
| Event id | `4b876564-18fd-4162-ae7b-af96b8641713` |
| Event location | `68b5faca-52e3-469d-9a5b-e0cde6575b98` |
| 최종 상태 | SETTLED |

Catalog seed (`npm run seed:pilot-rehearsal`)는 행사 자체를 만들지 않는다. 주최자/36 SKU/Assortment/준비물/본사 재고만 준비하고, 행사는 ADMIN UI에서 생성했다.

---

## Test users

비밀번호는 `LOCAL_DEV_PASSWORD` (로컬 환경변수). Git에 넣지 않는다.

| Role | Display | Phone |
| --- | --- | --- |
| MASTER / ADMIN | 로컬 MASTER | 010-0000-0001 |
| STAFF | 로컬 직원 | 010-0000-0002 |
| PART_TIMER | 로컬 알바 | 010-0000-0005 |

로그인:

* ADMIN: `/admin/login`
* STAFF / PART_TIMER: `/login` → `/my-events`

---

## Organizer

주최자 **네이처플러스** (`6a12a5cd-6320-427e-8fbd-b66058be5b87`):

| Check | Result |
| --- | --- |
| 주최자명 | PASS |
| Calendar Color `#16A34A` / `rgb(22,163,74)` | PASS (관리자 Calendar bar) |
| 기본 계약 COMMISSION 18% | PASS |
| 담당자 김본사(HQ), 박매장(VENUE) | PASS |
| Event Terms Snapshot | PASS (행사 생성 후 수수료형 18%) |
| Event Contact Snapshot | PASS (김본사, 박매장) |

행사 생성 화면에서 주최자 `get`이 수 초~십수 초 걸린다. 계약 combobox가 그동안 **없음**으로 남는다. 로드가 끝난 뒤 제출하면 Snapshot이 정상이다. 너무 일찍 제출하면 클라이언트가 `contract_type: NONE`과 빈 담당자를 보낸다 (`R-01`). 서버는 body에 `contract_type`이 있으면 Organizer Terms를 덮어쓰지 않는다.

---

## ADMIN Rehearsal

경로: `/admin/login` → 행사 생성 → 상세 탭 → 상태 SETTLED.

| # | Step | Result | Note |
| --- | --- | --- | --- |
| 1 | `/admin/login` | PASS | 010-0000-0001 |
| 2 | Organizer 확인 | PASS | 이름, 색, 18%, 담당자 2명 |
| 3 | 행사 생성 | PASS | Terms/Contact Snapshot은 async 대기 후. 조기 제출은 CONFUSING (`R-01`) |
| 4 | Calendar 표시 | PASS | 9/21–25 녹색 bar, 주최자 필터 동작. 선택일 목록은 leftover 행사로 밀도 높음 (`R-02`) |
| 5 | 행사 정보 수정 | PASS | 메모 `Pilot rehearsal — 판교점 테스트 행사` |
| 6 | 직원 배정 | PASS | 로컬 직원 STAFF |
| 7 | 알바 배정 | PASS | 로컬 알바 PART_TIMER |
| 8 | 준비물 구성 | PASS | `Pilot 백화점세트` 적용. seed 재실행 시 줄 중복 (`R-03`). “오늘 시작” 배너는 시작일이 오늘이라 맞음 |
| 9 | Assortment | PASS | `Pilot 판교 36SKU`, 36 SKU. 세트 목록 로딩 느림 (`R-06`). Preview/미리보기 혼용 (`R-08`) |
| 10 | OPENING 재고실사 | PASS | FULL 36 SKU. 밴드 ZERO/VERY_LOW/HALF/HIGH/FULL. 미입력 필터, 저장 후 다음, 나갔다 재입장, 마지막 SKU, CONFIRMED 이후 “확정된 실사는 수정하지 않습니다.” 기본 kind가 ROUTINE (`R-05`) |
| 11 | 재고 이동 | PASS | HQ → Event `MV-20260921-0019` DRAFT → DISPATCHED → RECEIVED. Event → Event는 이 행사에서 수행하지 않음 (`R-04`) |
| 12 | ACTIVE | PASS | 진행중 |
| 13 | ROUTINE 실사 | PASS | PARTIAL 1 SKU CONFIRMED |
| 14 | 일매출 | PASS | Day1 카드 500,000 + 현금 80,000. Day2 명시적 0원. 09-23~25 미입력 칩 |
| 15 | 비용 | PASS | 식비 35,000 `Pilot 도시락` |
| 16 | 영수증 사진 | CONFUSING | `사진 찍기` (`capture=environment`) 컨트롤은 있음. 이 Cursor 브라우저에서는 파일 첨부를 완료하지 못함 (`R-07`) |
| 17 | CLOSING 실사 | PASS | FULL 36 CONFIRMED (`3c020f49-99e9-4a12-b2b2-2e139cf2263e`). 36 SKU 입력은 helper로 채우고 UI에서 확정 흐름을 확인 |
| 18 | 잔여재고 이동 | PASS | `남은 재고 보내기` → 전 분류 본사 → `이동 작성` DRAFT `MV-20260921-0020` → `/movements`에서 출발/도착. 작성만으로는 수령 완료가 아님 (`R-10`) |
| 19 | ENDED | PASS | 배지 종료 |
| 20 | 예상손익 | PASS | 총매출 580,000 / 지출 35,000 / 수수료 104,400 / 원가 200,000 / 순이익 240,600. 원가 NULL → 0 → 200,000 구분 확인 |
| 21 | SETTLED | PASS | 배지 정산완료. 상태 변경+refresh가 로컬에서 수십 초 걸릴 수 있음 (`R-06`) |

ADMIN full flow: **가능.**

---

## STAFF Rehearsal

`/login` 010-0000-0002 → `/my-events` (제목 **내 행사**).

| Check | Result |
| --- | --- |
| 로그인 동선 | PASS |
| 배정된 행사만 표시 | PASS (RLS `event_members`). 로컬 DB에 verify leftover 배정이 많아 카드가 많음 (`R-15`) |
| 행사정보 | PASS. ← 내 행사. 장소/시간/주소/전화 |
| 행사준비 | PASS. 세트 적용 UI 없음. 준비완료/현장확인/회수 버튼 있음 |
| 재고실사 | PASS. 실사 시작, 이력, 현재 예상 약 0개(종료 이동 후) |
| 허용된 재고이동 | PASS. `/movements` 목록·도착 확인. **새 이동 작성**은 ADMIN 전용 |
| 매출 입력 | PASS. 칩·저장 폼 |
| 비용 입력 | PASS. 지출 추가 |
| 영수증 | PASS. 사진 찍기 컨트롤 |
| Organizer 이름 | PASS. 네이처플러스 |
| Organizer 색상 | 필드 홈/상세에 color-dot 없음 (`R-11`) |
| 계약금액 미노출 | PASS. `수수료형`만. 18% / 104,400원 / 손익 없음 |
| ADMIN 화면 | PASS. `/admin` `/users` `/organizers` `/events/new` → `/my-events`. 관리자 nav 없음 |

STAFF flow: **가능.** 실제 Pilot에서는 해당 행사만 배정하면 “내 행사”가 한 장으로 줄어든다.

---

## PART_TIMER Rehearsal

판정 기준: 컴퓨터에 익숙하지 않은 단기 알바가 **별도 교육 없이** 오늘 행사를 찾아 기본 업무를 할 수 있는가.

`/login` 010-0000-0005 → `/my-events` (제목 **오늘 행사**).

| Check | Result |
| --- | --- |
| 로그인 | PASS. 전화번호+비밀번호, 큰 버튼 |
| 오늘 행사 찾기 | 행사 1건만 배정되면 PASS. 이 로컬 DB는 leftover 배정 때문에 유사 카드가 많고 Pilot 행사가 접힘 (`R-15`) — 실제 Pilot에서는 배정 1건으로 운영 |
| 행사장/시간 | PASS. 롯데백화점 판교점, 10:30~20:00, 주소 탭, `tel:` |
| 준비사항 | PASS. 큰 준비완료 버튼. 중복 줄은 혼동 (`R-03`) |
| 재고실사 | PASS. 실사 시작이 큼. 기본값이 중간 실사 (`R-05`) |
| 허용 입력 | PASS. 매출/지출/준비 상태. 손익·수수료 없음 |
| 실수 복구 | 준비 상태는 미확인으로 되돌릴 수 있음. 매출은 다시 저장 가능. CONFIRMED 실사는 수정 불가(안내문 있음). 지출 취소는 ADMIN만 (`R-13`) |

PART_TIMER 기본 flow: **가능.** 교육 없이 쓰려면 실제 Pilot에서 (1) 그 알바에게 해당 행사만 배정하고 (2) “오늘 카드 하나 누르기 → 행사준비 / 재고 / 매출·지출” 세 탭만 말하면 된다. 영어 배지 `PART_TIMER`는 방해 수준이 아님 (`R-14`).

---

## Inventory Rehearsal

36 SKU (12 스타일 × Beige/Black/Navy). 100+ SKU stress는 하지 않았다.

| Check | Result |
| --- | --- |
| 미입력 필터 | PASS |
| ZERO / VERY_LOW / HALF / HIGH / FULL | PASS (UI 밴드 + 묶음 수) |
| 저장 후 다음 | PASS |
| SKU skip 없음 | PASS (P1-03 이후) |
| 나갔다 들어와도 입력상태 | PASS (DRAFT 이어하기) |
| 마지막 SKU | PASS |
| CONFIRMED 이후 수정 불가 | PASS |

OPENING `3786cbd7-93a8-45b6-b3b9-99b526f87a1b` CONFIRMED. ROUTINE PARTIAL `226e080a-529a-4eea-91f2-ed4792256985` CONFIRMED. CLOSING `3c020f49-99e9-4a12-b2b2-2e139cf2263e` CONFIRMED.

로컬에서 `get-check` / 서명 URL이 느리다 (`R-06`). 기능 실패는 아님.

---

## Movement Rehearsal

| Movement | Path | Status | Result |
| --- | --- | --- | --- |
| `MV-20260921-0019` | 본사 → 가을 양말 행사 Pilot | RECEIVED | PASS. UI에서 DRAFT→출발→도착 |
| `MV-20260921-0020` | 가을 양말 행사 Pilot → 본사 | RECEIVED | PASS. Closing 분배로 생성 후 출발/도착 |

| Check | Result |
| --- | --- |
| DRAFT → DISPATCHED → RECEIVED | PASS |
| source 감소 / destination 증가 | PASS (종료 후 행사 location `estimated_units` min=max=0) |
| 음수 방지 | PASS. 행사 location 음수 0건. DB `estimated_units >= 0` |
| Other Event → Event | 이 Pilot 행사에서는 미실시. 목적지 picker에 leftover location 27개가 이름 중복 (`R-04`). 같은 DB의 e2e `A행사 판교 → C행사 부산` RECEIVED는 별도 증거 |

운영 주의: `이동 작성` 또는 `남은 재고 보내기`는 DRAFT다. 현장/본사가 `/movements`에서 **출발**과 **도착**을 눌러야 재고가 움직인다 (`R-10`).

---

## Finance Rehearsal

| Day | Sales | Expense | UI |
| --- | --- | --- | --- |
| 09-21 | 580,000 (카드 500,000 + 현금 80,000) | 식비 35,000 | `입력완료 · 580,000원` |
| 09-22 | 0원 명시 저장 | — | `입력완료 · 0원` |
| 09-23~25 | 없음 | — | `미입력` |

Product Cost: 비움(NULL, 순이익 미완료 안내) → 0 (순이익 440,600) → 200,000 (순이익 240,600). placeholder “미입력”과 값 0이 구분된다. 접근성 이름은 값이 있어도 “미입력”으로 남을 수 있음 (`R-09`).

STAFF/PART_TIMER에게 손익·수수료·원가 입력은 보이지 않는다.

---

## Closing / Settlement

순서대로 수행함:

1. CLOSING FULL 확정
2. 남은 재고 보내기 (분류별 목적지 = 본사)
3. 이동 출발 / 도착
4. ENDED
5. 예상손익 확인
6. SETTLED

불명확했던 점 (기능 실패 아님):

* 종료 실사 확정 ≠ 재고가 본사로 간 것
* `이동 작성` ≠ 도착
* 날짜가 지나도 ENDED/SETTLED는 자동이 아님 (의도)
* SETTLED 이후에도 필드 매출/준비 버튼이 열려 있다 (`R-12`). 운영으로 만지지 않으면 된다

행사 종료/정산: **가능.**

---

## Mobile (390px)

Cursor 브라우저에서 `390×844` device metrics. `app-shell` 너비 390px. 실제 휴대전화 Safari/Chrome은 이 세션에서 열지 못했다.

| Screen | Result |
| --- | --- |
| 로그인 | PASS. 큰 로그인 버튼, tel 키패드 |
| 내 행사 / 오늘 행사 | PASS. 카드 탭 영역 충분. leftover가 많으면 스크롤 (`R-15`) |
| 행사 상세 | PASS. 탭 한 줄, 주소/전화 복사 |
| 행사준비 | PASS. 준비완료 등 큰 버튼. 항목이 많으면 스크롤 |
| 재고실사 | PASS. 실사 시작 CTA. 기본값 중간 실사 (`R-05`) |
| 이동 | PASS (STAFF `/movements` 목록). leftover DRAFT가 많으면 혼동 (`R-10`) |
| 매출 | PASS. 미입력/0원/금액 칩이 줄바꿈되어도 구분됨 |
| 비용 | PASS |
| 영수증 사진 | 컨트롤 PASS. 실제 카메라 업로드는 미검증 (`R-07`) |

단순 여백/미관은 Gap으로 올리지 않았다. 반복적으로 업무를 막는 밀도 문제는 leftover 데이터 쪽이다.

---

## Issue Log

### R-01

* **Role:** ADMIN
* **Screen:** `/events/new`
* **Type:** UX / WORKFLOW
* **Severity:** P2
* **Scenario:** 주최자 선택 직후 행사 만들기
* **Observed:** 계약이 “없음”, 담당자 체크박스가 수 초~십수 초 후에 나타남
* **Expected:** 주최자 Terms/담당자가 보이거나, 로드 전 제출을 막음
* **Workaround:** 수수료형 18%와 김본사/박매장 체크가 보일 때까지 기다린다
* **Pilot Blocking:** No
* **Recommended Action:** Pilot 체크리스트에 대기. Fix는 승인 후 (제출 disable 또는 서버가 organizer terms를 항상 snapshot)

### R-02

* **Role:** ADMIN
* **Screen:** `/admin` Calendar
* **Type:** UX
* **Severity:** P2
* **Scenario:** 선택일 목록
* **Observed:** verify leftover 행사가 많아 Pilot 행사를 찾기 어려움. 그리드 필터는 동작
* **Expected:** 운영 DB에서는 실제 행사만
* **Workaround:** 주최자 필터 네이처플러스
* **Pilot Blocking:** No
* **Recommended Action:** 실제 Pilot은 깨끗한 환경. Calendar 밀도는 기존 Gap Check P2

### R-03

* **Role:** ADMIN / STAFF / PART_TIMER
* **Screen:** 행사준비
* **Type:** DATA
* **Severity:** P2
* **Scenario:** `seed:pilot-rehearsal` 재실행 후 세트 적용
* **Observed:** 같은 준비물이 두 줄씩, 10/5 항목
* **Expected:** 세트 줄은 SKU/품목당 1줄
* **Workaround:** 리허설 환경 한정. 실제 Pilot은 세트를 한 번만 적용
* **Pilot Blocking:** No
* **Recommended Action:** 운영자는 세트 적용을 한 번만. seed 재실행 시 add-set-item duplicate 허용 로직 Backlog

### R-04

* **Role:** ADMIN
* **Screen:** 이동 작성 / 남은 재고 보내기 목적지
* **Type:** UX
* **Severity:** P2
* **Scenario:** HQ 또는 다른 행사로 보내기
* **Observed:** location 27개, 이름 중복, 본사가 아래쪽
* **Expected:** 활성 HQ/행사만, 이름+유형 정렬
* **Workaround:** “본사”를 스크롤해서 고른다
* **Pilot Blocking:** No
* **Recommended Action:** 실제 Pilot location을 최소로 유지. picker 정렬은 Backlog

### R-05

* **Role:** ADMIN / STAFF / PART_TIMER
* **Screen:** 재고 탭
* **Type:** WORKFLOW
* **Severity:** P2
* **Scenario:** 실사 시작
* **Observed:** 기본값이 중간 실사 (ROUTINE)
* **Expected:** 행사 시작 전에는 시작 실사가 기본이거나, 선택이 더 뚜렷함
* **Workaround:** 시작/종료 실사일 때 콤보를 명시적으로 고른다
* **Pilot Blocking:** No
* **Recommended Action:** 체크리스트에 “시작 실사 / 종료 실사 확인”. UI 기본값 변경은 승인 후

### R-06

* **Role:** ALL
* **Screen:** Assortment 세트, 실사 get-check, 위치 목록, 상태 변경
* **Type:** UX
* **Severity:** P2
* **Scenario:** 더러운 로컬 DB + 서명 URL
* **Observed:** 수 초~수 분 대기. 빈 화면처럼 보이다가 채워짐
* **Expected:** 현장 체감 수 초
* **Workaround:** 기다린다. 실제 Pilot DB는 verify leftover가 없음
* **Pilot Blocking:** No
* **Recommended Action:** 실제 Pilot은 깨끗한 프로젝트. list-products 페이지네이션은 별도 작업 (이번 범위 아님)

### R-07

* **Role:** ADMIN / STAFF
* **Screen:** 매출·지출 영수증
* **Type:** UX
* **Severity:** P2
* **Scenario:** 영수증 사진
* **Observed:** UI에 `사진 찍기` (`capture=environment`) 있음. Cursor 브라우저에서는 파일 첨부를 완료하지 못함. `verify:phase8` “영수증 여러 장 업로드”는 PASS
* **Expected:** 휴대폰에서 사진 1장 첨부
* **Workaround:** 실제 휴대폰으로 당일 1건 확인
* **Pilot Blocking:** No
* **Recommended Action:** 실제 Pilot 시작 전 휴대폰 1대로 업로드 1건. 제품 결함으로 보지 않음

### R-08

* **Role:** ADMIN
* **Screen:** 상품구성
* **Type:** UX
* **Severity:** P3
* **Scenario:** Assortment 미리보기
* **Observed:** Preview / 미리보기 혼용
* **Expected:** 한국어 통일
* **Workaround:** 의미는 통함
* **Pilot Blocking:** No
* **Recommended Action:** Backlog

### R-09

* **Role:** ADMIN
* **Screen:** 손익 원가 입력
* **Type:** UX
* **Severity:** P3
* **Scenario:** 원가 200000 입력 후
* **Observed:** 접근성 이름이 placeholder “미입력”
* **Expected:** 값 또는 “원가”
* **Workaround:** 화면의 숫자는 보임
* **Pilot Blocking:** No
* **Recommended Action:** Backlog

### R-10

* **Role:** ADMIN
* **Screen:** 남은 재고 보내기 → `/movements`
* **Type:** WORKFLOW
* **Severity:** P2
* **Scenario:** 종료 후 잔여 이동
* **Observed:** `이동 작성` 후 목록에 leftover DRAFT가 섞임. 출발/도착은 별 버튼
* **Expected:** 방금 만든 이동이 맨 위, 다음 행동이 분명함
* **Workaround:** 번호 `MV-…`로 찾는다. 출발 후 도착
* **Pilot Blocking:** No
* **Recommended Action:** 체크리스트에 “작성 → 출발 → 도착”. leftover 없는 환경 사용

### R-11

* **Role:** STAFF / PART_TIMER
* **Screen:** 내 행사 / 행사 상세
* **Type:** UX
* **Severity:** P3
* **Scenario:** Organizer 색상
* **Observed:** 이름만. Calendar color-dot 없음
* **Expected:** 관리자 Calendar와 같은 색 힌트
* **Workaround:** 주최자 이름으로 구분
* **Pilot Blocking:** No
* **Recommended Action:** Backlog / Pilot Feedback

### R-12

* **Role:** STAFF / PART_TIMER
* **Screen:** 매출·지출, 행사준비
* **Type:** WORKFLOW
* **Severity:** P2
* **Scenario:** SETTLED 이후
* **Observed:** 매출 저장, 준비 버튼이 여전히 활성
* **Expected:** 정산 완료 후 현장 입력 잠금이 있으면 더 안전
* **Workaround:** 정산 후 계정으로 수정하지 않는다
* **Pilot Blocking:** No
* **Recommended Action:** 운영 규칙. 잠금은 승인 후 (전이 그래프와 함께)

### R-13

* **Role:** PART_TIMER
* **Screen:** 지출
* **Type:** PERMISSION
* **Severity:** P2
* **Scenario:** 잘못된 지출 입력
* **Observed:** 취소(void)는 ADMIN만
* **Expected:** 방금 넣은 건을 본인이 취소하거나, 관리자에게 바로 요청
* **Workaround:** ADMIN이 취소. 메모에 잘못 입력 표시
* **Pilot Blocking:** No
* **Recommended Action:** 알바 교육 한 줄. 본인 void는 Backlog

### R-14

* **Role:** PART_TIMER
* **Screen:** 오늘 행사
* **Type:** UX
* **Severity:** P3
* **Scenario:** 역할 배지
* **Observed:** `PART_TIMER` 영어
* **Expected:** 알바
* **Workaround:** 업무에 불필요
* **Pilot Blocking:** No
* **Recommended Action:** Backlog

### R-15

* **Role:** STAFF / PART_TIMER
* **Screen:** `/my-events`
* **Type:** DATA / UX
* **Severity:** P2
* **Scenario:** 오늘 행사 찾기
* **Observed:** RLS는 배정분만 보여 줌. 로컬 verify가 같은 계정을 여러 행사에 넣어 카드가 많음
* **Expected:** 실제 Pilot 알바는 해당 행사 1건
* **Workaround:** 실제 배정을 최소로. 이 리허설 leftover는 제품 버그 아님
* **Pilot Blocking:** No
* **Recommended Action:** 실제 Pilot 전날 배정 목록 확인

---

## Counts

| Severity | Count | IDs |
| --- | --- | --- |
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 11 | R-01, R-02, R-03, R-04, R-05, R-06, R-07, R-10, R-12, R-13, R-15 |
| P3 | 4 | R-08, R-09, R-11, R-14 |

| Security issue | 0 |
| Data integrity issue | 0 |

Security: STAFF/PART_TIMER는 AdminGuard로 관리 화면 차단. 계약 금액·손익 미노출. 행사 읽기는 `event_members`.

Data integrity: 음수 재고 없음. CONFIRMED 실사 불변. 매출 미입력 vs 0원 구분. 조기 행사 생성은 운영 실수 가능하나 이번 리허설 Snapshot은 정상.

단순 편의사항 (언어 혼용, 배지 영어, 필드 색상)은 Pilot Feedback / P3.

---

## Go/No-Go

**GO FOR REAL PILOT**

| GO 조건 | Result |
| --- | --- |
| P0 = 0 | Yes |
| Security issue = 0 | Yes |
| Data integrity issue = 0 | Yes |
| ADMIN full flow 가능 | Yes |
| STAFF flow 가능 | Yes |
| PART_TIMER 기본 flow 가능 | Yes |
| 행사 종료/정산 가능 | Yes |

P2/P3는 실제 Pilot을 막지 않는다. P0/P1 Fix 작업은 열지 않았다.

실제 행사 투입 전 운영으로 막을 것:

1. 깨끗한 환경 (verify leftover 행사/이동/배정 없음)
2. 행사 생성 시 Terms/담당자 로드 대기
3. 실사 kind를 시작/중간/종료로 명시 선택
4. 잔여 이동은 작성 후 출발·도착까지
5. 알바에게 해당 행사만 배정
6. 휴대폰으로 영수증 1장 확인

---

## 실제 행사 Pilot 체크리스트

실제 행사 전날/당일용. 이 리허설을 실 Pilot 시작으로 치지 않는다.

### 행사 전날

* [ ] 사용자 계정: ADMIN, 현장 STAFF, PART_TIMER 로그인 확인 (`/admin/login`, `/login`)
* [ ] 로그인 기간(`login_allowed_*`)이 행사 기간을 덮는지
* [ ] 행사 배정: 그날 근무자만 해당 행사 `event_members`에 있는지. 불필요한 배정 해제
* [ ] Organizer: 이름, Calendar Color, 담당자 전화
* [ ] 행사 Snapshot: 계약 유형/요율, 담당자 김본사 같은 현장이 맞는지 (생성 직후 한 번 더 열어서 확인)
* [ ] Assortment: 취급 SKU가 매대와 일치 (36이 아니라 **그날 실제 구성**)
* [ ] 준비물: 세트 적용 한 번, 중복 줄 없는지
* [ ] 초기 재고: 본사 또는 이전 행사 위치를 확인하고 HQ → Event 이동 DRAFT가 있으면 출발까지
* [ ] 알바에게 말할 세 탭: 행사준비 / 재고 / 매출·지출
* [ ] 휴대폰 한 대로 로그인 + 영수증 `사진 찍기` 1건

### 행사 시작

* [ ] STAFF/PART_TIMER `/login` 성공
* [ ] 내 행사/오늘 행사에서 **그 매장 카드 하나**가 보이는지
* [ ] OPENING: 실사 종류를 **시작 실사**로 바꾼 뒤 전체 확정. 기본값 중간 실사를 그대로 누르지 말 것
* [ ] 준비상태: 랙/조명/단말기 등 준비완료
* [ ] HQ → Event 이동이 있으면 **도착**까지

### 행사 중

* [ ] 필요 시 ROUTINE (부분 가능)
* [ ] 매일 매출: 0원이면 0원으로 저장. 칩이 미입력이면 아직 안 넣은 것
* [ ] 비용 + 영수증 사진
* [ ] 재고 부족 시 이동. STAFF는 목록에서 도착. 새 이동 작성은 ADMIN
* [ ] 잘못된 지출은 ADMIN이 취소

### 행사 종료

* [ ] CLOSING: 종류를 **종료 실사**로 선택 후 전체 확정
* [ ] 잔여재고 화면에서 분류별 목적지 (보통 본사)
* [ ] `이동 작성` 후 `/movements`에서 **출발 → 도착**
* [ ] 매출 칩: 영업일마다 입력완료 또는 0원. 미입력 영업일이 남지 않았는지
* [ ] 비용/영수증 누락 없는지

### 행사 후

* [ ] 상태 **종료 (ENDED)** — 날짜가 지나도 자동이 아님
* [ ] 손익: 원가 NULL/0/금액 구분. 수수료가 Snapshot 요율과 맞는지
* [ ] 상태 **정산완료 (SETTLED)**
* [ ] SETTLED 이후 현장 계정으로 매출/준비를 고치지 않음

### 하지 말 것

* Phase 9 / Supplier / PO / Native 범위를 당일 요구로 넣지 않음
* 확정된 실사를 고치려 하지 않음. 필요하면 새 중간 실사
* 리허설 편의를 위해 Production Logic을 바꾸지 않음

---

## Helpers (local only)

Production Logic을 바꾸지 않는다. 리허설 catalog/실사 대량 입력용:

* `npm run seed:pilot-rehearsal` — 주최자, 36 SKU, Assortment, 준비 세트, 본사 위치
* `scripts/pilot-rehearsal-fill-check.mjs` — DRAFT 실사 잔여 채우기
* `scripts/pilot-rehearsal-close.mjs` — CLOSING 생성·채우기·확정
* `scripts/pilot-rehearsal-recv.mjs` — 이동 출발+도착

비밀번호는 환경변수만. `scripts/pilot-receipt.png` 같은 로컬 바이너리는 커밋하지 않는다.

---

## Regression

리허설 후 기존 자동검증 (로컬 `ajumsocks` DB, leftover 있음).

| Check | Result |
| --- | --- |
| `verify:pilot-gaps` | PASS |
| `verify:organizers` | PASS |
| `verify:phase0` | PASS |
| `verify:phase1` | PASS (먼저 leftover `010-0000-9010`~`9013` 충돌을 지운 뒤. 제품 회귀 아님) |
| `verify:phase2` | PASS |
| `verify:phase3` | PASS |
| `verify:phase4` | PASS |
| `verify:phase5` | PASS |
| `verify:phase6` | PASS |
| `verify:phase7` | PASS (Event→Event 포함) |
| `verify:phase8` | PASS |
| `verify:e2e` | PASS |
| `verify:erd` | PASS |
| `npm run build` | PASS |
| Secret scan | PASS. live `sb_secret_…` / JWT 없음. `.env` untracked. 문서의 `service_role` 설명만 |

Phase 1 첫 실행은 이전 verify leftover 전화번호와 충돌했다. 로컬 테스트 계정 4개를 지운 뒤 재실행하면 PASS. Production Logic 변경 없음.
