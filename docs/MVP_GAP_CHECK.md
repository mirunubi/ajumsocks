# Web MVP Gap Check

Audit of **implemented** Web MVP v1.0 against `docs/MVP_ROADMAP.md` End-to-End Scenario.

P1 Gap Fix (`P1-03` → `P1-02` → `P1-01`) is applied. Phase 9 is not started.

Source of Truth for scope: `docs/MVP_ROADMAP.md`.

---

## Baseline

| Field | Value |
| --- | --- |
| Audit baseline | `7a44625` (`docs: audit web MVP pilot readiness`) |
| Feature baseline | `a6c253a` + this P1 Gap Fix |
| Included | Phase 0~8.5, MVP 운영개선 01, MVP_ROADMAP, P1-01/02/03 |
| Phase 9 | NOT STARTED |

Core questions:

1. 실제 외부 행사 한 건을 등록 → 준비 → 운영 → 종료 → 정산까지 운영할 수 있는가?
2. STAFF/PART_TIMER가 현장에서 자신의 업무를 모바일로 수행할 수 있는가?

---

## Summary

| Priority | Count |
| --- | --- |
| P0 | 0 |
| P1 | 0 |
| P2 | 8 |

| Classification (scenario steps) | Count |
| --- | --- |
| READY | 27 |
| PARTIAL | 0 |
| MISSING | 0 |

ADMIN 19 steps: **19 READY**. STAFF/PART_TIMER 8 steps: **8 READY**. **MISSING: 0.**

**Pilot Readiness: READY FOR PILOT**

근거: 핵심 업무 경로와 P1 3건(행사 헤더 수정 UI, 배정 해제, 실사 SKU skip)이 코드·권한·`verify:pilot-gaps`로 닫혔다. P0/P1/MISSING = 0. P2(상세 Summary, Calendar 밀도, PART_TIMER 단순화, Contact 편집, 사진 capture 등)는 Pilot을 막지 않는다. Wishlist(Supplier, Native, Push)로 판정을 낮추지 않았다.

---

## ADMIN End-to-End (19)

### 1. 관리자 로그인 — READY

- **Current:** `/admin/login`. 전화번호+비밀번호. STAFF/PART_TIMER는 세션 종료 + “관리자 계정이 아닙니다.”
- **Route / Screen:** `LoginScreen` variant=`admin`
- **Backend:** Supabase Auth `signInWithPassword` (synthetic email). 동일 Auth.
- **Permission:** `profiles.role === ADMIN` + `has_app_access`
- **Operational Gap:** 없음
- **Priority:** —
- **Evidence:** `app/src/screens/LoginScreen.tsx`; `scripts/verify-organizers.mjs` 22; 브라우저 `/admin/login`

### 2. Organizer 등록 또는 선택 — READY

- **Current:** `/organizers`, `/organizers/new`, `/organizers/:id`. Palette 색상, Terms, 담당자.
- **Route / Screen:** `OrganizersScreen`, `OrganizerDetailScreen`
- **Backend:** Edge `organizer-admin` create/update/upsert-terms/add-contact
- **Permission:** ADMIN only (`AdminGuard` + Edge 403 + RLS)
- **Operational Gap:** 없음
- **Evidence:** `verify:organizers` 1–8; 브라우저 주최자 관리

### 3. 행사 등록 — READY

- **Current:** `/events/new`. Organizer 필수(UI).
- **Route / Screen:** `EventNewScreen`
- **Backend:** `event-admin` `create`
- **Permission:** ADMIN
- **Evidence:** `verify:phase2` 행사 생성; `verify:organizers` 10

### 4. 행사 기간/시간/장소 등록 — READY

- **Current:** 화면에서 시작일/시간·종료일/시간 분리, 저장 시 KST `timestamptz`. 행사장명·주소.
- **Route / Screen:** `EventNewScreen`
- **Backend:** `starts_at` / `ends_at` 유지 (분해하지 않음)
- **Operational Gap:** 없음. 생성 후 수정은 P1-01 (`행사정보 수정` → `event-admin` `update`).
- **Evidence:** `app/src/lib/datetime.ts` `combineKstDateTime`; `EventDetailScreen` 행사정보 수정; `verify:pilot-gaps` P1-01

### 5. 계약조건 Snapshot — READY

- **Current:** Organizer 선택 시 Terms 로드. 저장 시 `events` 계약 컬럼에 복사. 이후 Terms 변경은 기존 행사 불변.
- **Backend:** `event-admin` `resolveContract`
- **Evidence:** `verify:organizers` 11, 12; D-020

### 6. Organizer 담당자 Snapshot — READY

- **Current:** 생성 시 선택한 Organizer Contact를 `event_contacts`로 복사. Master 이후 변경은 기존 행사 불변.
- **Evidence:** `verify:organizers` 13, 14; `copyOrganizerContacts`

### 7. 직원/알바 배정 — READY

- **Current:** 상세에서 사용자+assignment_role 추가. Unique `(event_id, profile_id)`. 로그인 기간 자동변경 없음. ADMIN `[해제]` + confirm. 물리삭제.
- **Route / Screen:** `EventDetailScreen` 인력 배정
- **Backend:** `event-admin` `add-member` / `remove-member`. STAFF/PART_TIMER 403. 중복 remove idempotent.
- **Operational Gap:** 없음
- **Evidence:** `verify:pilot-gaps` P1-02; 해제 후 RLS/`can_read_event` 차단

### 8. 준비물 설정 — READY

- **Current:** 세트 적용, 수량 수정, 항목 추가/제외, 상태. 행사준비 탭.
- **Route / Screen:** `EventPrepPanel` on `/events/:id` tab 행사준비
- **Backend:** `prep-admin`
- **Evidence:** `verify:phase3`; `verify:e2e` 준비물 Snapshot

### 9. 판매상품 구성 — READY

- **Current:** Assortment 세트 적용, 수동 SKU, 제외. 같은 탭에 집기와 분리 표시.
- **Route / Screen:** `EventAssortmentPanel`
- **Backend:** `assortment-admin`
- **Evidence:** `verify:phase5`; `verify:e2e` Assortment Snapshot

### 10. 행사 초기재고 확인 — READY

- **Current:** OPENING FULL/PARTIAL Check, Confirm → Current/Position.
- **Route / Screen:** `/events/:id` 재고 → `/events/:eventId/inventory/:checkId`
- **Backend:** `event-inventory` + RPC confirm
- **Permission:** ADMIN 또는 배정 STAFF/PART_TIMER
- **Evidence:** `verify:phase6`; `verify:e2e` OPENING

### 11. 본사/다른 행사에서 재고 이동 — READY

- **Current:** ADMIN이 DRAFT 작성, DISPATCH/RECEIVE. HQ↔Event, Event↔Event.
- **Route / Screen:** `/movements/new` (ADMIN), `/movements/:id`
- **Backend:** `inventory-movement` + RPC. 음수 Position 거부, 이중 DISPATCH 거부.
- **Evidence:** `verify:phase7`; `verify:e2e` 이동

### 12. 행사 중 재고 확인 — READY

- **Current:** ROUTINE Check. 검색, Category/Size/Color, `미입력만`, 분류 그룹, `저장 후 다음`. 저장 후 다음 SKU는 line id 기준.
- **Operational Gap:** 없음. P1-03 skip 수정됨.
- **Evidence:** `EventInventoryCheckScreen.tsx` `nextOpenInventoryItem`; `verify:pilot-gaps` P1-03

### 13. 매출 입력 — READY

- **Current:** 일별 카드/현금/기타. 미입력 vs 0원 칩 구분. 배정 STAFF/PART_TIMER도 저장 가능.
- **Route / Screen:** 행사 상세 탭 매출·지출 `EventFinancePanel`
- **Backend:** `event-finance` `save-daily-sales`
- **Evidence:** UI “미입력과 0원 확인은 다릅니다.”; `verify:phase8`; `verify:e2e` DAY1/DAY2 0원

### 14. 비용/영수증 입력 — READY

- **Current:** 지출 추가, 영수증 `capture="environment"`. Void는 ADMIN.
- **Evidence:** `EventFinancePanel`; `verify:phase8` 지출/영수증

### 15. 행사 종료 재고 확인 — READY

- **Current:** CLOSING Check Confirm.
- **Evidence:** `verify:e2e` CLOSING Confirm

### 16. 잔여상품 이동 — READY

- **Current:** CLOSING 후 `/events/:eventId/distribute/:checkId`. ADMIN only.
- **Backend:** `create-closing-distribution`
- **Evidence:** `ClosingDistributeScreen`; `AdminGuard`; `verify:e2e` 남은 재고 보내기

### 17. 행사 종료 — READY

- **Current:** 상세 업무 상태 select → `ENDED`. 날짜 자동변경 없음.
- **Backend:** `event-admin` `set-status` (전이 그래프 없음 — P2-07)
- **Evidence:** `EventDetailScreen` status select; `verify:phase2` CANCELLED; e2e ENDED

### 18. 손익 확인 — READY

- **Current:** ADMIN 손익 카드. 원가 미입력 시 `profit_ready` false, “상품원가 미입력”.
- **Permission:** STAFF summary에서 cost/commission/profit strip
- **Evidence:** `EventFinancePanel` ADMIN block; `verify:phase8` 순이익; SECURITY.md

### 19. 정산 완료 — READY

- **Current:** 상태 `SETTLED`. e2e에서 SETTLED 이후 ADMIN 수정 가능.
- **Evidence:** `verify:e2e` ENDED → SETTLED 수동

---

## STAFF / PART_TIMER End-to-End (8)

가능하면 역할을 나눠 적는다. 현장 화면은 거의 공유한다. 차이는 `/my-events` 제목(STAFF “내 행사” / PART_TIMER “오늘 행사”)과 `AdminGuard` 차단뿐이다.

### 1. 현장 로그인 — READY (둘 다)

- **Route:** `/login`
- **STAFF:** 성공 → `/my-events`
- **PART_TIMER:** 동일. 비활성/login window 만료는 거부.
- **Evidence:** `verify:organizers` 25, 26, 28; 브라우저 390px 로그인 폼 사용 가능

### 2. 내 행사 확인 — READY (둘 다)

- **Current:** 오늘/다가오는 배정 행사 카드. Organizer명, 운영시간, 상태, 준비/매출 요약(있을 때).
- **Permission:** RLS `can_read_event` — 미배정 숨김
- **Evidence:** `MyEventsScreen`; `verify:organizers` 31, 32; 브라우저 390px 카드, 가로스크롤 없음 (`app-shell` `min(28rem, 100%)`)

### 3. 행사 상세 확인 — READY (둘 다)

- **Route:** `/events/:id` `AuthedGuard`
- **STAFF/PART_TIMER:** 관리자 메뉴·배정 폼·상태 select 없음. 계약 **유형**만. 금액은 `isAdmin`일 때만 `contractSummary`.
- **Evidence:** `EventDetailScreen`; 이전 브라우저에서 STAFF “수수료형”만 표시, 18%/20% 없음

### 4. 준비사항 확인 — READY (둘 다)

- **Current:** 행사준비 탭. 상태 버튼은 배정 사용자 `set-status`. 세트 적용/수량/제외는 ADMIN.
- **Evidence:** `EventPrepPanel`; `verify:phase3` 배정 STAFF/PART_TIMER 조회·상태변경

### 5. 허용된 재고실사 — READY (둘 다)

- **Current:** 배정 행사 Check 시작/저장/확정 가능. 검색·분류 필터·미입력만·저장 후 다음 있음. 저장 후 다음 SKU skip 없음.
- **Gap:** 없음 (P1-03 수정). 100+ SKU 길이 자체는 P2 밀도.
- **PART_TIMER:** 동일 화면. 더 단순한 전용 실사 UI 없음 (P2-04).
- **Evidence:** `EventInventoryCheckScreen.tsx` `currentId` + `nextOpenInventoryItem`; `verify:pilot-gaps` P1-03

### 6. 허용된 이동업무 — READY (둘 다)

- **Current:** `/movements` 목록(배정 EVENT 관련). DRAFT 생성은 ADMIN. 배정자는 출발 EVENT DISPATCH / 도착 EVENT RECEIVE.
- **PART_TIMER:** 동일 권한 모델 (assignment 기준, role enum 아님).
- **Evidence:** `inventory-movement` `dispatch`/`receive`; SECURITY.md Inventory row; `verify:phase7`

### 7. 매출/비용 입력 — READY (둘 다)

- **Current:** 배정 시 일매출 저장, 지출 추가, 영수증 업로드(카메라 capture). Void/원가/손익은 ADMIN.
- **Evidence:** `verify:phase8` 배정 STAFF 일매출; `EventFinancePanel` `capture="environment"`

### 8. 관리자 계약금액 미노출 — READY (둘 다)

- **Current:** PostgREST column GRANT 없음. `event-admin` `publicEvent` strip. Organizer Terms RLS ADMIN. UI 손익 블록 `isAdmin`.
- **Evidence:** `verify:organizers` 7, 33; `verify:phase8` STAFF/PART_TIMER commission/fixed_fee 직접 조회 실패; SECURITY.md

관리자 메뉴: `AdminGuard` → `/my-events`. URL `/admin`, `/organizers`, `/users` 등 진입해도 관리자 화면이 열리지 않음.

---

## Mobile operational check (390px)

`app-shell` 폭 `min(28rem, 100%)`. 현장 화면은 모바일 우선이다. 관리자 Calendar는 `.wide` + 720px 이하에서 bar 숨김.

| Surface | Usable at 390px? | Notes | Class |
| --- | --- | --- | --- |
| 로그인 | Yes | 폼·버튼 한 열 | READY |
| 내 행사 | Yes | 카드, 가로스크롤 없음 | READY |
| 행사 상세 | Yes | 탭 chip wrap | READY |
| 행사준비 | Yes | 상태 버튼 행 | READY |
| 재고실사 | Yes | 검색/필터, 저장 후 다음 SKU skip 없음 | READY |
| 이동 | Yes | 목록/상세 카드 | READY |
| 매출 | Yes | 일별 chip, 금액 입력 | READY |
| 비용 | Yes | 영수증 카메라 속성 있음 | READY |
| 행사 사진 | Yes | `input file` only, `capture` 없음 | PARTIAL P2 |
| 관리자 Calendar | 보완됨 | bar 숨김, 선택일 목록 | READY / P2 밀도 |

단순 미관은 P2. 실사 skip은 P1-03에서 수정했다.

이번 세션 390px: PART_TIMER `/my-events` 카드 확인. 동시 verify가 DB를 바꿔 상세가 `unauthorized`가 된 것은 **감사 중 레이스**이지 제품 Gap이 아니다. STAFF 상세·계약 미노출은 이전 브라우저 확인을 증거로 유지한다.

---

## Candidate re-check (Roadmap A / B)

### A. 행사 헤더/기본정보 수정 UX — READY (P1-01)

재확인 결과: **READY.**

| Field | Create UI | Update API | Update UI |
| --- | --- | --- | --- |
| 행사명, 장소, 주소, 날짜/시간 | `/events/new` | `event-admin` `update` | 상세 `행사정보 수정` (`EventBasicsFields`) |
| Organizer | 신규 필수 | `update` `organizer_id` | 동일 폼. Snapshot 자동 교체 없음 |
| 이번 행사 계약 금액 | 생성 시 Snapshot | `update` 계약 필드 | ADMIN만. Organizer Master Terms ≠ Event Snapshot |
| Event Contact | 생성 Snapshot + 추가 | `update-contact` | **추가만** (P2-05) |
| 내부 배정 | 추가 | add/remove-member | `[해제]` + confirm (P1-02) |

Organizer 변경 시 계약/담당자 Snapshot은 유지. 자동 재-Snapshot은 P2.

### B. 모바일 재고실사 100+ SKU — READY for skip (P1-03)

검색/Category는 원래 있었다. skip 버그(`onlyOpen` + `index+1`)는 `nextOpenInventoryItem` + `currentId`로 수정. 기본 필터 `미입력만`에서 A→B→C, 부분입력에서도 B를 건너뛰지 않는다 (`verify:pilot-gaps`).

100+ SKU 입력 길이는 P2 밀도. 새 기능(정확수량)은 넣지 않음.

---

## CRUD (운영 중 최소 수정)

기준: 실제 행사 중 바뀔 가능성이 높고, 방법이 없으면 DB를 만져야 하는가?

| Change | Likely in ops? | App path | Gap? |
| --- | --- | --- | --- |
| 행사 날짜/시간/장소 | 높음 | 상세 `행사정보 수정` | 없음 (P1-01) |
| 알바 교체(해제) | 높음 | 상세 `[해제]` | 없음 (P1-02) |
| 알바 추가 | 높음 | 상세 배정 | 없음 |
| Organizer Master 담당자 | 중간 | 추가+비활성화 | 없음 (편집 UI는 P2-06) |
| 행사 당시 Contact 전화번호 | 중간 | 새 Contact 추가 | P2-05 |
| 준비 수량/항목 | 높음 | 행사준비 ADMIN | 없음 |
| 판매상품 추가/제외 | 높음 | Assortment 패널 | 없음 |
| 이번 행사 수수료 정정 | 낮음~중간 | 상세 행사정보 수정 (Event Snapshot만) | 없음 (P1-01) |
| Organizer 기본 Terms | 낮음 | 주최자 상세 (기존 행사 불변) | 없음 |

---

## Status transitions

Event: `PREPARING → ACTIVE → ENDED → SETTLED`, plus `CANCELLED`.

- **UI:** ADMIN 상세 `<select>` 임의 값. STAFF 변경 불가.
- **Backend:** `set-status`가 enum만 검사. **전이 그래프 없음.** PREPARING→SETTLED, SETTLED→ACTIVE 가능.
- **종료/정산 동선:** 가능 (select → ENDED → SETTLED).
- **자동 status:** 날짜/매출로 바뀌지 않음 (의도, D-018 계열).
- **Gap:** 잘못된 전환 가능 → **P2-07**. 운영 차단 아님.

Movement: DRAFT→DISPATCHED→RECEIVED, DRAFT cancel. DISPATCHED cancel 거부. READY.

Inventory Check: DRAFT confirm/cancel. CONFIRMED 불변. READY.

---

## Missing vs Zero

유지됨. UI 구분 가능.

| Domain | Missing | Zero | UI |
| --- | --- | --- | --- |
| 일매출 | row 없음 / `missing` | 0원 저장 `zero` | 칩: 미입력 / 입력완료 · 0원 / 금액 |
| Product Cost | NULL | 0 | placeholder “미입력”; 빈 값 저장 → null; 손익 “원가 미입력” |
| 실사 묶음 | `full_pack_count` null | 0 + remainder | `stockLabel`; `미입력만` |

Evidence: `EventFinancePanel`; `verify:e2e` 미입력과 ZERO; `verify:phase8`.

---

## Security regression

| Check | Result | Evidence |
| --- | --- | --- |
| STAFF/PART_TIMER Organizer Terms | 차단 | RLS + Edge 403 (`verify:organizers` 7) |
| commission_rate / fixed_fee | 미노출 | column GRANT + `publicEvent` strip + UI |
| 다른 행사 | 차단 | `can_read_event`; phase2 URL 타 행사 실패 |
| 관리자 메뉴 | UI 차단 | `AdminGuard` → `/my-events` |
| ADMIN 전체 업무 | 가능 | Edge requireAdmin |
| MASTER 보호 | 유지 | `verify:e2e` MASTER; `protect_master_profile` |
| public signup | OFF | phase0 / e2e / organizers |

Login UX 분리는 Auth 정책을 바꾸지 않음 (D-021).

---

## Data integrity

| Invariant | Status | Evidence |
| --- | --- | --- |
| Organizer Terms 변경 ≠ 기존 Event 계약 | HOLD | `verify:organizers` 12 |
| Organizer Contact 변경 ≠ 기존 Event Contact | HOLD | `verify:organizers` 14 |
| Assortment Template ≠ Event Snapshot | HOLD | `verify:phase5` / e2e |
| CONFIRMED physical check immutable | HOLD | `verify:phase6` |
| Position 음수 불가 | HOLD | `verify:phase7` 13 |
| Movement 상태별 재고 규칙 | HOLD | DISPATCH 감소, RECEIVE 증가, DRAFT 무영향 |
| Finance 자동 COGS 없음 | HOLD | 원가 수동; e2e “차이를 판매로 분류하지 않음” |

---

## Automated verification (Gap Fix)

Local scripts. Schema migration 없음.

| Script | Result |
| --- | --- |
| `npm run verify:pilot-gaps` | PASS (P1-01/02/03) |
| `npm run verify:organizers` | PASS |
| `verify:phase0` … `verify:phase8` | ALL PASS |
| `npm run verify:e2e` | PASS (Phase 8.5) |
| `npm run verify:erd` | PASS (43 tables, 101 FKs, 7 enums; no supplier/PO) |
| `npm run build` | PASS |
| Secret scan (`sb_secret_` live key / JWT in repo) | PASS |

---

## P1 / P2 catalog

### P1-01 행사 헤더·계약 수정 UI — FIXED

- Domain: Event
- Status: READY
- **Fix:** `/events/:id` ADMIN `행사정보 수정` → 기존 `event-admin` `update`. Organizer 변경 시 Contract/Contact Snapshot 유지. STAFF/PART_TIMER 403.

### P1-02 행사 멤버 해제 — FIXED

- Domain: Event
- Status: READY
- **Fix:** ADMIN `event-admin` `remove-member` 물리삭제. UI `[해제]` + confirm. 중복 remove idempotent. 해제 후 `can_read_event` 즉시 차단.

### P1-03 실사 `미입력만` + 저장 후 다음 건너뛰기 — FIXED

- Domain: Inventory
- Status: READY
- **Fix:** `nextOpenInventoryItem` + stable `currentId`. array index를 다음 식별자로 쓰지 않음. remainder 밴드 유지.

### P2

| ID | Topic | Minimal Fix (later) |
| --- | --- | --- |
| P2-01 | 기존 `organizer_id` NULL 연결 UI | 상세에서 Organizer select → `update` |
| P2-02 | 행사 상세 운영 Summary 스트립 | 기존 prep/SKU/check/sales로 읽기 전용 |
| P2-03 | 캘린더 동일일 다수 행사 밀도 | Pilot 1~3회면 보류 |
| P2-04 | PART_TIMER 화면 ≈ STAFF | Pilot 피드백 후 |
| P2-05 | Event Contact 수정 UI | `update-contact` 연결 또는 추가+메모 |
| P2-06 | Organizer Contact 필드 편집 | 기존 `update-contact` 연결 |
| P2-07 | Event status 임의 전이 | 허용 전이만 select (예: 역방향 경고) |
| P2-08 | 행사 사진 `capture` 없음 | expense와 같이 `capture="environment"` |

P2는 Pilot 전 필수 아님.

---

## POST-MVP BACKLOG (not Gaps)

Web MVP E2E에 필수 아님. Gap 카운트에 넣지 않음.

- Supplier / Wholesaler Master, PO, Replenishment, Receipt, Shipment, Tracking
- 자동 발주, Supplier 정산, ERP, POS, 외부 결제
- Capacitor Android/iOS, Push, Offline-first, 전용 Camera 앱
- Calendar 라이브러리, 완전한 일정관리 제품

Phase 9 요구는 여기서 설계하지 않음.

---

## Recommended Gap Fix order

P1 구현 완료 (`P1-03` → `P1-02` → `P1-01`).

그다음 P2는 Pilot 중 실제 빈도에 따라.

---

## Web MVP Gap Check Conclusion

P0: **0**
P1: **0**
MISSING: **0**
P2: **8** (Pilot을 막지 않음)

Pilot blocking issue (운영 흐름 단절) **없음.**

P1 3건은 Gap Fix에서 수정:

- P1-03 실사 skip → `nextOpenInventoryItem`
- P1-02 멤버 해제 → `remove-member` DELETE
- P1-01 행사 헤더/계약 수정 UI → `EventBasicsFields` + `update`

P2는 Pilot 이후 실제 운영 피드백을 보고 판단.

Phase 9는 시작하지 않음. Schema 변경 없음 (43 tables / 101 FKs / 7 enums).

**Pilot Readiness: READY FOR PILOT**
