# Phase 1 User Management Plan

상태: **계획 (MASTER PLAN 자체검토 완료)**

상위 문서: `docs/00_MASTER_PLAN.md`, `docs/01_PHASE0_FOUNDATION_PLAN.md`
충돌 시 MASTER PLAN을 우선한다.

한글 상호: **아점양말 (아점삭스)**
시스템 이름: `ajumsocks`

Phase 2 행사/상품/재고는 이 문서 범위가 아니다.

운영 앱:

```text
https://app.ajumsocks.co.kr
https://app.ajumsocks.co.kr/invite/{token}
```

로컬 앱:

```text
http://127.0.0.1:5173
http://127.0.0.1:5173/invite/{token}
```

---

# 1. Phase 0 보완 (본 Phase 착수 전제)

## 1.1 API Key

Browser / PWA:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY   # sb_publishable_...
```

Edge Function / 로컬 Admin 스크립트:

```text
SUPABASE_SECRET_KEY             # sb_secret_...
```

신규 코드는 Legacy `anon key` / `service_role key`를 기본 전제로 쓰지 않는다.
PostgreSQL RLS role 이름 `anon` / `authenticated` 는 유지한다.

Client bundle에 넣지 않는 것:

* Secret Key
* legacy service_role JWT
* BYPASSRLS credential

## 1.2 Remote 공개 Sign Up

Local `enable_signup = false` 만으로 원격을 만족했다고 보지 않는다.

hosted `ajumsocks` 체크리스트:

1. Dashboard → Authentication → Providers → Email
2. **Allow new users to sign up = OFF**
3. Phone/SMS signup OFF
4. Site URL = `https://app.ajumsocks.co.kr`
5. Redirect `https://app.ajumsocks.co.kr/**`
6. 브라우저 `signUp` 거부 확인

## 1.3 SECURITY DEFINER

```text
schema private   (API schemas에 넣지 않음)
  has_app_access()
  current_app_role()
  is_admin_user()
  is_master_user()
  protect_master_profile()
  set_updated_at()
```

* `SET search_path = ''`
* schema-qualified (`public.profiles`, `auth.uid()`, `pg_catalog.now()`)
* PUBLIC/anon EXECUTE 없음
* RLS에 필요한 `has_app_access`, `is_admin_user`만 `authenticated` EXECUTE
* 클라이언트는 helper RPC에 의존하지 않음

## 1.4 개발 Credential

`LOCAL_DEV_PASSWORD`는 로컬 환경변수만.
production seed / 운영 DB / Git / client bundle 금지.

## 1.5 상태 enum을 추가하지 않는 이유

`INVITED / ACTIVE / INACTIVE` 컬럼은 만들지 않는다.

이미 있는 것:

* `is_active` — RLS가 보는 업무 스위치
* `login_allowed_from/until` — 기간
* `invites` — 초대 대기/사용/취소/만료

세 번째 상태 컬럼은 `is_active=true` 인데 `INVITED` 같은 모순을 만든다.
목록 표시는 계산 필드다.

```text
초대대기 = 미사용·미취소·미만료 invite
활성     = is_active 이고 기간 내
비활성   = is_active false (초대대기 필터와 분리)
```

---

# 2. ADMIN 사용자 등록 Flow

```text
ADMIN 로그인 (전화번호 + 비밀번호)
  → /users
  → 이름 / 전화 / 역할
  → PART_TIMER면 로그인 시작·종료일 입력 권장
  → POST user-admin action=create  (JWT, Publishable Key)
  → Edge Function (Secret Key)
       전화 정규화
       중복이면 기존 profile 반환 (신규 생성 없음)
       Auth User 사전 생성 (내부 email identity, 메일 미발송)
       임시 random password (응답/로그/DB 평문 없음)
       profile insert  is_active=false
       invite token 생성, hash만 저장
  → ADMIN 화면에 초대 URL 1회 표시
  → 사람이 카카오톡/문자로 전달 (앱 SMS 없음)
```

공개 Sign Up 페이지/API 없음.

---

# 3. Auth User Provisioning

Browser는 Auth Admin API를 호출하지 않는다.

```text
입력 010-1234-5678
  → E.164  +821012345678
  → 내부 identity  821012345678@users.local.ajumsocks
```

변환은 공통함수 하나 (`phoneToAuthEmail`). UI에 내부 email을 보여 주지 않는다.

`createUser`:

* `email_confirm: true` (메일 발송 없음)
* 임시 긴 random password
* 공개 signup 경로 사용 안 함

---

# 4. profiles

Phase 0 컬럼 유지. 상태 enum 추가 없음.

최초 등록:

* Auth User 존재
* profile 존재
* invite 존재
* `is_active = false`

수락 후에만 `is_active = true`.
기간 조건은 Phase 0과 동일. UI가 아니라 RLS가 최종 경계.

전화번호 변경은 profile UPDATE로 하지 않는다. Auth identity와 함께 서버에서 바꿔야 하므로 **MVP UI 없음, Extension Point**.

---

# 5. 일회성 invite

테이블 `public.invites`:

```text
id, profile_id, token_hash, created_at, expires_at, used_at, revoked_at, created_by
```

* 원본 token 컬럼 없음. SHA-256 hash만 저장
* Cryptographically Secure Random
* 일회용, 만료, 사용 후 재사용 불가, ADMIN 취소 가능
* 활성 초대는 profile당 1개
* 재발급 시 기존 활성 초대 반드시 폐기
* 로그에 원본 token 금지

URL:

```text
https://app.ajumsocks.co.kr/invite/{token}
```

---

# 6. 초대 수락 / 최초 비밀번호

```text
/invite/:token
  → preview: 홍*동 / 010-****-1234
  → 새 비밀번호 + 확인 (8자 이상)
  → Edge Function invite-accept
       token 검증 (만료/취소/사용)
       Auth password 교체 (Secret Key)
       used_at
       is_active=true
  → 클라이언트가 전화번호+비밀번호로 로그인
  → 홈
```

Token 검증과 Auth Admin은 Browser에서 하지 않는다.

---

# 7. 재고용 / 활성·비활성

PART_TIMER는 삭제하지 않는다.

```text
기간 종료 → RLS 차단, 계정 보존
재고용 → 기존 사용자 검색 → login_allowed_* 변경 → 필요 시 재초대
행사 배정은 Event Phase
```

비밀번호를 모르면 신규 생성이 아니라 재초대.

ADMIN은 MASTER가 아닌 사용자에 한해 `is_active` / 기간 / 역할을 서버 API로 변경한다.

---

# 8. MASTER 보호

삭제 / 비활성 / 강등 / `is_master` 제거 불가.
trigger `private.protect_master_profile` + Edge Function 가드.
일반 ADMIN이 우회할 수 없다.

---

# 9. Edge Function 보안경계

```text
user-admin      verify_jwt = true
invite-accept   verify_jwt = false
```

* CORS: `127.0.0.1:5173`, `localhost:5173`, `https://app.ajumsocks.co.kr`
* Secret Key는 함수 런타임만
* `user-admin` 호출자는 `ADMIN` + 접근기간 내

로컬 Edge runtime이 Secret을 레거시 환경변수명으로 주입하면 `SUPABASE_SECRET_KEY`를 먼저 읽고, 없을 때만 런타임 주입값을 사용한다. 브라우저에는 넣지 않는다.

---

# 10. RLS

* 모든 public 업무 테이블 RLS
* 업무 접근: `private.has_app_access()`
* profiles SELECT: 본인 또는 ADMIN
* profiles/invites 쓰기는 클라이언트 없음
* invites SELECT: ADMIN만

---

# 11. Mobile UI

| 경로 | 대상 |
|---|---|
| `/login` | 전체 |
| `/` | 로그인 사용자 |
| `/users` | ADMIN 가드 |
| `/invite/:token` | 비로그인 가능 |

사용자 관리 목록: 이름, 전화, 역할, 활성, 시작/종료, 초대상태, 최근 로그인, 등록일.
검색: 이름/전화. 필터: 역할/활성/비활성/초대대기.
PART_TIMER 기간 입력 강조. 카드 레이아웃.

하지 않음: SMS OTP, SMS 발송, 공개/이메일 가입, Social, MFA, 행사/상품/재고, 전화 변경 UI.

---

# 12. Migration 계획

이미 적용된 Phase 0 파일은 수정하지 않는다.

```text
20260919130000_private_security.sql
20260919130100_invites.sql
20260919130200_private_grants.sql
```

---

# 13. 테스트 시나리오

1. 공개 Sign Up 실패
2. ADMIN만 사용자 목록
3. STAFF/PART_TIMER 타인 목록 불가
4. 전화 중복 시 신규 생성 없음
5. 생성 시 Auth + profile + invite, is_active false
6. 수락 전 업무 접근 불가
7. 정상 invite 최초 사용
8. 동일 invite 재사용 실패
9. 만료 실패
10. revoked 실패
11. 비밀번호 8자 미만 실패
12. 활성화 후 전화번호+비밀번호 로그인
13–15. 비활성 / 기간 전 / 기간 후 실패
16. MASTER 수정/비활성/강등 실패
17. Client bundle에 Secret Key 없음
18. `supabase db reset`
19. `npm build`

---

# 14. MASTER PLAN 충돌 검토

| 항목 | 결과 |
|---|---|
| 공개 Sign Up 금지 | 유지 |
| 전화+비밀번호, SMS 없음 | 유지. 내부 email identity 유지 |
| 초대 hash / 일회용 / 만료 / 취소 | 유지 |
| Secret는 서버만, Publishable만 브라우저 | 유지 (용어를 신규 키 체계로 정리) |
| MASTER 보호 | 유지 |
| RLS 최종 경계 | 유지 |
| `supabase/migrations` 원본, 기존 파일 수정 금지 | 유지 |
| 행사/상품/재고 | 하지 않음 |
| `app.ajumsocks.co.kr` | 유지 |
| 아점양말/아점삭스 표시명 | 유지 |
| DEFINER를 private로 | Phase 0 승인 노트. 충돌 없음 |

충돌 없음.

---

# 16. MASTER Bootstrap

MASTER는 migration/seed로 만들지 않는다.

```text
scripts/provision-master.mjs
```

환경변수:

```text
MASTER_BOOTSTRAP_PHONE
MASTER_BOOTSTRAP_PASSWORD
MASTER_BOOTSTRAP_DISPLAY_NAME   # 선택, 기본 MASTER
```

Hosted에서는 `SUPABASE_URL` + `SUPABASE_SECRET_KEY` 를 쓴다.
로컬은 `supabase status`의 Secret Key를 쓴다.

동작:

* 전화 정규화 + 기존 internal email identity
* 없으면 Auth User + profile 생성 (ADMIN, is_master, is_active, 기간 NULL)
* 같은 전화 MASTER가 있으면 재실행해도 추가 생성하지 않음
* 다른 전화 MASTER가 있으면 실패
* 비밀번호는 출력/저장하지 않음
* 최초 로그인 후 비밀번호 변경, 이후 환경변수 제거

Hosted 사람이 확인할 것:

1. `db push --dry-run` 후 적용
2. Allow new users to sign up = OFF
3. MASTER bootstrap
4. 로그인 / ADMIN / 보호 확인
5. 임시 비밀번호 변경 후 환경변수 제거


* `profiles.id`가 행사 배정 FK가 된다
* 재고용 시 새 행사 연결 (이 Phase에서 행사 테이블 없음)
* 전화번호 변경은 Auth identity와 함께 서버 작업
