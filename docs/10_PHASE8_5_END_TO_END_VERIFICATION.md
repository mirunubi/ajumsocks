# Phase 8.5 End-to-End Operational Verification

상태: **검증 완료**

상위: `docs/00_MASTER_PLAN.md`, Phase 0–8  
새 업무기능 / Schema / 발주·보충요청은 이 문서 범위가 아니다.

한글 상호: **아점양말 (아점삭스)**

목적: Phase 0–8이 **하나의 행사 운영흐름**으로 연결되는지 확인한다.

자동화: `scripts/verify-e2e-phase8.mjs` (`npm run verify:e2e`)  
기존 `verify:phase0`–`verify:phase8`을 대체하지 않는다.

---

# 정리 원칙

임시 사용자/초대는 **만들지 않는다.**

로컬 시드만 사용한다.

| 전화 | 역할 |
|---|---|
| 010-0000-0001 | MASTER / ADMIN |
| 010-0000-0002 | STAFF |
| 010-0000-0005 | PART_TIMER |
| 010-0000-0004 | 기간만료 (접근차단 확인용) |
| 010-0000-0003 | 비활성 (접근차단 확인용) |

테스트 행사·상품·준비물·실사·이동·매출은 스크립트가 `E2E` / `Phase 8.5` 접두로 만든다.  
운영 원격 DB에 넣지 않는다. 로컬은 `supabase db reset`으로 초기화한다.

---

# 시나리오

행사명: `Phase 8.5 통합테스트 행사`  
행사장: `E2E 테스트 행사장`  
기간: 한국시간 기준 근접 4일 (스크립트가 KST로 계산)  
계약: MIXED, 수수료 10%, 입점비 300,000원

상대 행사: `Phase 8.5 이동목적지 행사` (EVENT → EVENT 이동용)

---

# 단계

1. 사용자 — ADMIN 전체, STAFF/PART_TIMER 배정만, 미배정 차단, 기간만료 차단. MASTER 보호.
2. 행사 생성 — 기본정보, MIXED, 내부/외부 담당자, 사진. STAFF 화면에 본인 행사만.
3. 준비물 — 랙/조명/멀티탭/카드단말기/쇼핑백 세트 적용. Template 수정 후 Snapshot 불변. 미확인→준비완료→현장확인. 집기 회수완료. 소모품은 회수 미강제.
4. 상품구성 — 신생아/아동/성인여성/성인남성 Set을 **SKU Rule로 고정**해 적용 (이전 Phase leftover SKU 비간섭). Snapshot, 수동추가 1 / 제외 1, Master 수정 후 Snapshot 불변.
5. OPENING FULL — 0 / 1~2 / 약 5 / 약 7~8 / 10 / 1묶음+잔량 / 2묶음+잔량. 미입력≠ZERO. 미입력 Confirm 실패, 전체입력 Confirm, Current·Position Baseline (출고 없이도 인정).
6. 재고이동 — EVENT→HQ, EVENT→EVENT. DRAFT는 Position 불변. DISPATCH Source 감소, RECEIVE Destination 증가. 발송≠수령 차이 보존, 판매/분실 자동분류 없음.
7. ROUTINE — 예상 약 28 → 현장 약 25로 재기준화. 과거 Movement/Check History 불변.
8. 일매출 — DAY1 1,100,000 입력완료. DAY2 0원 확인. 나머지 미입력.
9. 지출 — 주차/식비/배송, 영수증 1+, 수정 Audit, ADMIN void 후 손익 제외.
10. 예상 상품원가 — 먼저 NULL → 손익 미완료. 이후 금액 입력. STAFF/PART_TIMER API에서 원가·수수료·입점비·순이익 없음.
11. 손익 — 서버 Summary = 수기 (총매출 − 원가 − void제외 지출 − 수수료 − 입점비). MIXED 둘 다. KRW round.
12. CLOSING — Confirm 후 Current/Position. 남은 재고 보내기 Preview. Category별 목적지, Source-Destination별 Movement 분리. 생성된 DRAFT는 Position 불변.
13. ENDED → SETTLED 수동. Finance가 status 자동변경하지 않음. SETTLED 후 ADMIN 수정 시 Audit.
14. 보안 회귀 — signup, MASTER, 기간만료, 미배정, STAFF Admin API, 범위초과, bundle Secret.
15. 정합성 — orphan 없음, 음수 Position 없음, DRAFT/RECEIVE/History/void/NULL원가/Snapshot 불변.

버그 발견 시: 원인 → 영향 Phase → 최소수정 → regression → db reset → build → E2E 재실행. 새 사업기능으로 고치지 않는다.

Schema 변경이 없으면 Migration을 만들지 않는다.

---

# 실행

```text
npx supabase db reset
node scripts/provision-local-users.mjs
node scripts/write-app-env.mjs
npm --prefix app run build
npm run verify:e2e
npm run verify:phase0
… npm run verify:phase8
```

`verify:phase1`은 행사 배정 후 같은 행사 동료 프로필이 보일 수 있다(Phase 2 `profiles_select_event_colleague`). MASTER/미배정 ADMIN 조회는 계속 차단한다.

`verify:phase5` 카테고리 Preview는 leftover SKU가 있어도 **필수 SKU 포함**으로 판정한다. 카테고리 전체 exclusive count는 단일 Phase 리셋 전제이다.

---

# 결과 (로컬)

| 항목 | 결과 |
|---|---|
| E2E Workflow | PASS |
| Phase 0–8 verify (E2E 이후 같은 DB) | PASS |
| `supabase db reset` | PASS |
| `npm build` | PASS |
| Secret scan | PASS |
| Schema / Migration | 없음 |
| 제품 버그 | 없음 |

테스트 isolation만 조정했다.

* Phase 1: STAFF는 배정 행사 동료 프로필을 볼 수 있음. MASTER 조회는 계속 차단.
* Phase 5: 카테고리 Preview는 필수 SKU 포함으로 판정.

Phase 9는 시작하지 않는다.
