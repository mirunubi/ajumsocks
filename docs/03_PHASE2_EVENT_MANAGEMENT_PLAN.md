# Phase 2 Event Management Plan

상태: **구현 기준**

상위 문서: `docs/00_MASTER_PLAN.md`
충돌 시 MASTER PLAN을 우선한다.

한글 상호: **아점양말 (아점삭스)**

Phase 3 준비물/상품/재고/매출은 이 문서 범위가 아니다.

---

# 1. 목표

ADMIN이 외부 판매행사를 만들고, 배정된 STAFF/PART_TIMER는 모바일에서 **자기 행사만** 본다.

로그인 허용기간과 행사기간은 분리한다. 배정해도 `profiles.login_allowed_*` 를 자동 변경하지 않는다.

---

# 2. 테이블

계약정보는 별도 테이블로 쪼개지 않는다. 행사 규모상 `events` 컬럼이면 충분하다.

## 2.1 public.events

```text
id                 uuid PK
name               text not null
starts_at          timestamptz not null
ends_at            timestamptz not null
status             event_status not null default PREPARING
venue_name         text not null
address            text not null
address_detail     text
memo               text
contract_type      event_contract_type not null default NONE
commission_rate    numeric(5,2)          -- 0~100, %
fixed_fee          numeric(12,0)         -- KRW
contract_memo      text
created_by         uuid references public.profiles(id)
created_at         timestamptz
updated_at         timestamptz
check (ends_at >= starts_at)
```

status code → UI:

```text
PREPARING  준비중
ACTIVE     진행중
ENDED      종료
SETTLED    정산완료
CANCELLED  취소
```

날짜로 status를 덮어쓰지 않는다. 일정 힌트(예정/진행기간/종료됨)는 UI 계산값이다.

contract_type:

```text
NONE / COMMISSION / FIXED_FEE / MIXED
```

손익 엔진은 만들지 않는다. 값 저장과 형식 검증만 한다.

물리 DELETE UI 없음. 운영 취소는 `CANCELLED`.

## 2.2 public.event_members

```text
id                 uuid PK
event_id           uuid not null → events
profile_id         uuid not null → profiles
assignment_role    event_assignment_role not null
created_at         timestamptz
created_by         uuid → profiles
unique (event_id, profile_id)
```

assignment_role: `MANAGER` / `STAFF` / `PART_TIMER`

시스템 `profiles.role` 과 다른 축이다. ADMIN이 행사 MANAGER가 될 수 있다.

중복 배정 금지. 배정 행은 삭제하지 않는다 (과거 이력).

## 2.3 public.event_contacts

```text
id, event_id, contact_type, name, company, department, position, phone, memo, sort_order
```

contact_type: `VENUE` / `HQ` / `OTHER`

고정 1/2/3 컬럼 없음. N명.

## 2.4 public.event_photos

```text
id, event_id, storage_path, original_filename, mime_type, file_size,
caption, photo_type, uploaded_by, created_at
```

파일은 Storage. DB는 metadata만. 행사당 20장 이상.

---

# 3. Index

```text
events (starts_at desc)
events (status)
event_members (event_id)
event_members (profile_id)
event_contacts (event_id, sort_order)
event_photos (event_id)
```

---

# 4. Storage

Bucket: `event-photos` (private)

경로: `{event_id}/{uuid}_{filename}`

Migration으로 bucket + policy 생성. Dashboard 수동 생성 금지.

권한:

* ADMIN: 조회/업로드/삭제
* 배정된 STAFF/PART_TIMER: 해당 행사만 조회/업로드
* 미배정 행사 객체 조회 불가
* 삭제는 ADMIN만 (MVP)

## 4.1 삭제 순서

1. Storage object 삭제
2. 성공한 뒤에만 `event_photos` row 삭제
3. Storage 실패 시 DB row를 지우지 않음
4. Storage는 지워지고 DB만 남은 경우, 재시도로 row 삭제 가능 (고아 파일보다 깨진 URL이 나쁨)

업로드:

1. Edge Function이 권한 확인 후 경로 발급
2. 클라이언트가 Storage에 업로드
3. object 존재 확인 후 metadata insert
4. insert 실패 시 Storage 객체 삭제 시도

---

# 5. RLS / private helper

기존 원칙: `private` schema, `search_path = ''`, schema-qualified.

```text
private.can_read_event(event_id)
  has_app_access()
  AND (is_admin_user() OR event_members에 auth.uid())

private.can_write_event(event_id)
  has_app_access() AND is_admin_user()
```

SELECT:

* events / members / contacts / photos: `can_read_event`
* 생성·수정·배정·연락처 변경·취소를 포함한 쓰기는 authenticated에 허용하지 않음. Secret Key Edge Function만.

미배정 사용자가 URL에 event id를 넣어도 SELECT 0건.

---

# 6. Edge Functions

Browser는 Secret Key를 쓰지 않는다.

```text
event-admin     verify_jwt true
  list, get, create, update, set-status
  add-member, add-contact, update-contact

event-photos    verify_jwt true
  sign-upload, complete-upload, delete, list
```

`event-admin` 쓰기는 ADMIN + has_app_access.
`get`/`list`는 ADMIN은 전체, 그 외는 배정된 행사만 (함수도 RLS와 같은 규칙).

배정 시 로그인기간 자동 변경 없음.

---

# 7. 화면 (모바일 우선)

| 경로 | 대상 |
|---|---|
| `/` | 배정 행사 카드 (오늘/다가오는) |
| `/events` | ADMIN 행사관리 목록 |
| `/events/new` | ADMIN 생성 |
| `/events/:id` | 배정자 또는 ADMIN 상세 |

상세 상단: 행사명, 주소(복사), 담당자 전화, 사진.

상세 본문: 기간, 상태, 내부 담당, 외부 담당, 계약정보, 메모, 사진 갤러리.

준비물/상품/재고/매출/지출/손익/발주 탭을 빈 화면으로 만들지 않음.

지도 API 없음. 주소 텍스트 + 복사.

영구삭제 버튼 없음. 상태는 CANCELLED 가능.

---

# 8. MASTER PLAN 충돌 검토

| 항목 | 결과 |
|---|---|
| 준비물/상품/재고/매출 아직 구현 안 함 | 유지 |
| SQL Migration 원본 | 새 파일만 추가 |
| RLS + private helper | 유지 |
| Publishable만 브라우저 | 유지 |
| 사진 Storage, DB는 metadata | 유지 |
| PWA 모바일 우선 | 유지 |
| 로그인기간과 행사 배정 분리 | MASTER의 재고용/기간 원칙과 맞음 |
| event_members가 알바 이력 연결점 | Phase 1 Extension Point 충족 |

충돌 없음.

---

# 9. Phase 3 Extension Point

* `event_id` 기준 준비물 체크리스트
* 상품 구성/재고는 이후 테이블이 `events.id` 를 FK로 참조
* 사진 `photo_type` 확장
* 로그인기간 제안 UX (자동 변경은 하지 않은 채 제안만)
