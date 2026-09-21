# MVP Roadmap

ajumsocks MVP의 목적은 기능을 최대한 많이 만드는 것이 아니라,
외부 행사 한 건을 등록부터 종료·정산까지 실제로 운영할 수 있는 시스템을 만드는 것이다.

새로운 기능 아이디어는 Web MVP 완료 조건에 직접 필요하지 않다면
MVP 이후 Backlog로 보낸다.

Architecture, Schema, Security의 현재 구현 설명은 이 문서에 다시 쓰지 않는다. 각각 `docs/ARCHITECTURE.md`, `docs/SCHEMA_INVENTORY.md`, `docs/SECURITY.md`, `docs/DECISIONS.md`를 본다. Pilot 준비 감사는 `docs/MVP_GAP_CHECK.md`. Web MVP 운영 리허설은 `docs/PILOT_REHEARSAL.md`.

---

## Current baseline

| Field | Value |
| --- | --- |
| Current MVP Baseline | `fd66f7e` (`fix: close web MVP pilot gaps`) |
| Included | Phase 0 ~ Phase 8.5, MVP 운영개선 01, P1 Gap Fix, MVP 운영개선 02 |
| Status | READY FOR PILOT |
| Real Event Pilot | NEXT |
| Phase 9 | not started |

---

## Web MVP v1.0

관리자가 행사를 등록하고, 주최자·담당자·계약·직원·알바를 설정하고, 행사 준비·상품구성·재고·이동·매출·지출을 관리한 후, 행사를 종료하고 정산 확인까지 할 수 있다.

STAFF/PART_TIMER는 자신에게 배정된 행사에서 허용된 현장업무를 수행할 수 있다.

완료 판정은 기능 개수가 아니라 아래 End-to-End Scenario다.

---

## Included

### Auth / User

* ADMIN / STAFF / PART_TIMER
* MASTER 보호
* 관리자 로그인 (`/admin/login`)
* 현장 로그인 (`/login`)
* Role 기반 Home
* login window
* public signup OFF

### Organizer

* 행사 주최자 Master (`event_organizers`)
* 주최자별 Calendar Color
* 주최자 담당자
* 기본 계약조건 (`event_organizer_terms`)
* Event 생성 시 Terms Snapshot
* Contact Snapshot (`event_contacts`)

일반 `vendors` 테이블은 쓰지 않는다. Organizer는 행사 주최자이고 Supplier는 상품 매입처다 (`docs/DECISIONS.md` D-019, D-020).

### Event

* 행사 등록
* 행사명, 행사장, 주최자, 주소
* 시작일 / 종료일, 시작시간 / 종료시간 (화면 분리, DB는 `starts_at` / `ends_at`)
* 상태 (PREPARING / ACTIVE / ENDED / SETTLED / CANCELLED)
* 일정 확정 (`schedule_status` TENTATIVE / CONFIRMED, lifecycle과 분리)
* 직원/알바 배정
* 행사 상세 (행사정보 / 행사준비 / 세팅·이동 / 재고 / 매출·지출)

### Calendar

* 관리자 월간 Calendar
* 다일 행사
* Organizer Color (확정 행사)
* 예정 행사 회색/`예정` badge
* Organizer Filter, 확정/예정 필터
* Mobile 대응 (셀 bar 숨김 + 선택일 목록)

### Preparation

* 집기, 운영물품, 소모품
* 준비상태, 현장상태, 회수상태

### Product / Assortment

* Product / SKU
* Category / Size / Color / Attribute / Tag
* Event Assortment 및 Event Snapshot
* 판매상품 준비현황

### Inventory

* Event Inventory Check (Approximate Inventory)
* OPENING / ROUTINE / CLOSING
* Inventory Location / Position / Movement
* 출발 / 수령
* Event Closing Distribution

### Setup / Operation

* Setup session 계획/도착/완료
* 설치 집기 mm Snapshot, 계획/실제 수량
* 도착·완료 사진 (`setup-photos`)
* 원본 서버시각 vs ADMIN 보정
* Operation location master
* Event/거점 이동 구간 (GEAR / CREW / BOTH)
* AI 예측·지도 API는 없음

### Finance

* 일매출, 비용, 영수증
* Product Cost 수동입력
* 계약 수수료 / 입점비
* 예상 손익
* 행사 종료 / 정산 상태

---

## Excluded

다음 Domain·기능은 Web MVP v1.0에 넣지 않는다.

* Supplier Master
* Wholesaler Master
* Purchase Order
* Replenishment Request
* Goods Receipt
* Shipment
* Delivery Tracking
* 자동 발주
* Supplier 정산
* ERP 회계
* POS 연동
* 외부 결제 연동
* Android Native 전용 기능
* iOS Native 전용 기능

`products.wholesaler_name`은 그대로 둔다. Phase 9 전에는 Supplier Domain을 확장하지 않는다.

---

## End-to-end scenarios

### 관리자

한 행사에서 처음부터 끝까지 동작해야 한다.

1. 관리자 로그인
2. Organizer 등록 또는 선택
3. 행사 등록
4. 행사 기간/시간/장소 등록
5. 계약조건 Snapshot
6. Organizer 담당자 Snapshot
7. 직원/알바 배정
8. 준비물 설정
9. 판매상품 구성
10. 행사 초기재고 확인
11. 본사/다른 행사에서 재고 이동
12. 행사 중 재고 확인
13. 매출 입력
14. 비용/영수증 입력
15. 행사 종료 재고 확인
16. 잔여상품 이동
17. 행사 종료
18. 손익 확인
19. 정산 완료

자동 검증의 대응은 `npm run verify:e2e` (Phase 8.5)와 `npm run verify:organizers`다. E2E PASS는 이 Scenario가 **로컬에서 한 번 통과했음**을 뜻한다. 실제 외부 행사 Pilot과는 별개다.

### STAFF / PART_TIMER

1. 현장 로그인
2. 내 행사 확인
3. 행사 상세 확인
4. 준비사항 확인
5. 허용된 재고실사
6. 허용된 이동업무 (배정 EVENT의 dispatch / receive)
7. 매출/비용 입력
8. 관리자 계약금액은 볼 수 없음

---

## Gap check (`a6c253a`)

이 문서를 쓴 시점의 분류다. **구현하지 않는다.** 다음 작업이 Gap 수정이다.

상태: **READY** / **PARTIAL** / **MISSING**

우선순위:

* **P0** — 행사 운영 자체가 불가능 (생성, 로그인, 재고 확인, 매출 저장, 종료 불가 등)
* **P1** — 운영은 가능하나 현장에서 큰 혼란/오류
* **P2** — 있으면 편하지만 MVP 운영에 지장 없음. Pilot 전 필수 아님

| ID | Domain | Status | 현재 상태 | 부족한 부분 | 실제 행사 운영 차단 | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| G-01 | Auth / User | READY | 관리자/현장 로그인, Role Home, MASTER, login window, signup OFF | 없음 | 아니오 | — |
| G-02 | Organizer | READY | Master, 색상, Terms/Contact, 생성 시 Snapshot, 비활성 유지 | 없음 | 아니오 | — |
| G-03 | Event | READY | 등록, 기간/시간, 배정·해제, 상세, 상태 전이 | 없음 (생성 경로) | 아니오 | — |
| G-04 | Event | READY | 생성 후 행사명/장소/주소/기간/Organizer/이번 행사 계약 수정 UI. `event-admin` `update`. Organizer 변경 시 Contract/Contact Snapshot 유지 | 없음 | 아니오 | — |
| G-05 | Event | PARTIAL | 기존 `organizer_id` NULL 행사는 미지정으로 표시 | 상세에서 Organizer 연결 UI 없음 | 아니오 (새 행사는 Organizer 필수) | P2 |
| G-06 | Event | PARTIAL | 상세 탭(정보/준비/재고/매출·지출)은 있음. 현장 카드에 준비·매출 요약을 일부 표시 | 상세 상단 운영 Summary(준비 완료, SKU 수, 최근 실사, 인원, 오늘 매출)가 한곳에 없음 | 아니오 | P2 |
| G-07 | Calendar | READY | 월간, 다일 bar, Organizer 색/필터, 모바일은 선택일 목록 | 없음 (1~3회 Pilot 밀도) | 아니오 | — |
| G-08 | Calendar | PARTIAL | 같은 날 다수 행사는 stack | 동시 행사가 많으면 셀이 붐빔 | 아니오 (Pilot 1~3회면 지장 없음) | P2 |
| G-09 | Preparation | READY | 마스터/세트/Snapshot, 준비·현장·회수 상태, 행사준비 탭 | 없음 | 아니오 | — |
| G-10 | Product / Assortment | READY | Product/SKU, 분류, Event Snapshot, 판매상품 섹션 | 없음 | 아니오 | — |
| G-11 | Inventory | READY | OPENING/ROUTINE/CLOSING, Position, Movement, Closing Distribution | 없음 (권한 정책 포함) | 아니오 | — |
| G-12 | Inventory | READY | 실사 화면 + 검색. 저장 후 다음은 line/`variant_id` 기준이라 `미입력만`에서 SKU skip 없음 | 100+ SKU는 여전히 입력이 길다 (P2 밀도) | 아니오 | — |
| G-13 | Finance | READY | 일매출, 지출/영수증, 원가 수동, 수수료/입점비 Snapshot, 손익, ENDED/SETTLED. STAFF는 계약금액·손익 차단 | 없음 | 아니오 | — |
| G-14 | Field UX | PARTIAL | `/my-events`, 배정 행사만, PART_TIMER 제목만 단순화 | PART_TIMER 화면이 STAFF와 거의 동일 | 아니오 | P2 |
| G-15 | Photos | PARTIAL | 행사 사진 업로드/조회 | 전용 Camera UX 없음 (파일 선택) | 아니오 | P2 |

**MISSING (Web MVP v1.0 포함 범위):** 없음.

**P0 Gap:** 0.

제외 범위(Supplier, PO, POS, Native 전용 등)는 Gap이 아니다. Backlog / Phase 9 / v1.5다.

---

## Gate: new work

모든 새 요구는 먼저 이 질문을 통과한다.

이 기능이 Web MVP v1.0 End-to-End Scenario를 완료하는 데 필수인가?

* **YES** — Gap으로 등록한 뒤 구현 가능
* **NO** — Backlog 또는 Phase 9 이후로 이동

예외: Security, Data Integrity, 치명적 Bug.

---

## Pilot entry

다음을 만족하면 **Web MVP 기능 추가를 중단**하고 Pilot으로 전환한다.

* P0 Gap = 0
* 주요 P1 해결
* 전체 regression PASS
* 모바일 사용 가능
* ADMIN end-to-end Scenario 가능
* STAFF/PART_TIMER 현장 Scenario 가능

새 Feature Idea는 Pilot 전에 넣지 않는다.

---

## Pilot

목표: 실제 외부 행사 **1~3회**를 ajumsocks로 운영한다.

기록할 문제 종류:

* BUG
* UX
* PERMISSION
* DATA
* WORKFLOW
* MISSING_OPERATION

Pilot 중에는 새 Business Domain을 만들지 않는다.

수정 우선순위:

1. 운영중단
2. 데이터 오류
3. 권한/보안
4. 반복적 현장불편
5. 일반 UX

---

## Web MVP Freeze

Pilot 이후 다음을 만족하면 **Web MVP Freeze**를 선언한다.

* 실제 행사 1~3회 운영
* 치명적 Bug 없음
* 중요 Workflow 변경 요구 없음
* 핵심 Schema 변경 요구 없음
* 로그인 / 재고 / 매출 / 비용 / 종료 정상
* 주요 모바일 UX 안정

Freeze 이후, Android/iOS 전환 전에 하지 않는 것:

* 대규모 Schema 변경
* Domain 추가
* Workflow 재설계

긴급 Bug / Security 수정은 허용한다.

---

## Android (v1)

**Web MVP Freeze 이후** 시작한다.

현재 React + TypeScript Web App과 Supabase Backend를 최대한 재사용한다. 우선 검토 방식은 **Capacitor**다. Android를 처음부터 별도 Native App으로 재작성하지 않는다.

1차 목표:

* 로그인
* 내 행사
* Calendar / Admin 화면
* 행사 상세
* 준비
* 재고실사
* 이동
* 매출/비용
* 사진촬영/업로드

정상 동작.

### Android 2차 (현장 최적화)

실제 운영에서 확인된 것만 추가한다. 예:

* Push Notification
* 행사 시작 알림
* 재고확인 요청
* 사진 Camera UX
* 앱 Resume 처리
* 네트워크 재시도
* 임시 저장

Offline-first 전체 구조는 실제 필요가 확인되기 전에는 도입하지 않는다.

---

## iOS (v1)

Android 안정화 후 **같은 공통 Web Codebase**로 iOS App을 만든다.

PART_TIMER가 iPhone을 사용해도 동일한 업무가 가능해야 한다. iOS 전용 Business Logic을 만들지 않는다.

재사용: React, TypeScript, Supabase, Domain Logic, UI 대부분.

---

## PWA

Android/iOS App이 완성된 이후에도 Web/PWA를 폐기하지 않는다.

* 관리자 PC
* 긴급 대체 접속
* 앱 미설치 PART_TIMER
* 개발/테스트
* 일부 iPhone 사용자 임시 접속

---

## Phase 9 start

Phase 9는 다음 **이후**에만 시작한다.

* Web MVP Freeze 완료
* Android v1 운영 가능
* iOS v1 운영 가능, 또는 운영상 충분한 대체수단 확보
* 실제 행사 운영 경험 축적

Phase 9 후보 (상세 설계하지 않음):

재고 부족 → 보충요청 → 기존 Location 재고 우선 → 부족수량 계산 → Supplier → Purchase Order → Shipment → Receipt → Inventory Position 반영

---

## Versions

| Version | Meaning |
| --- | --- |
| v1.0 | Web Event Operations MVP |
| v1.5 | Android + iOS Mobile Operations |
| v2.0 | Purchasing / Replenishment / Supplier |

---

## Status

| Stage | Status |
| --- | --- |
| Phase 0~8.5 | COMPLETE |
| MVP 운영개선 01 | COMPLETE |
| MVP 운영개선 02 | COMPLETE |
| Web MVP Gap Check | COMPLETE — `docs/MVP_GAP_CHECK.md` |
| Web MVP Gap Fix | COMPLETE |
| Pilot Rehearsal | COMPLETE — `docs/PILOT_REHEARSAL.md` (GO FOR REAL PILOT; 실제 행사 미착수) |
| Real Event Pilot | NEXT |
| Web MVP Freeze | PENDING |
| Android v1 | PENDING |
| Android Pilot | PENDING |
| iOS v1 | PENDING |
| Mobile v1.5 | PENDING |
| Phase 9 | NOT STARTED |

Baseline: **`fd66f7e`**. Real Event Pilot is still **NEXT**.
