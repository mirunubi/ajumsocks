# AjumSocks Phase 0 Foundation Plan

상태: **Phase 0 구현 기준 (인증 정책 확정)**

본 문서는 `docs/00_MASTER_PLAN.md`의 하위 실행 계획이다.
MASTER PLAN과 충돌하면 MASTER PLAN을 우선한다.

행사·재고·매출 업무기능과 Phase 1 초대 UI는 구현하지 않는다.

---

# 1. Phase 0 목적

로컬에서 `supabase start`로 개발하고, 검증된 Migration만 원격 hosted 프로젝트 `ajumsocks`에 `db push`할 수 있는 토대를 만든다.

1차 Client는 모바일 우선 Web/PWA다.
로그인 방식은 **전화번호 + 비밀번호**다.
SMS OTP와 공개 Sign Up은 구현하지 않는다.

---

# 2. 완료조건

* `npx supabase start`로 로컬 Auth / Storage / Postgres / Studio가 뜬다.
* `npx supabase db reset`으로 Migration이 처음부터 다시 적용된다.
* PWA 기본화면이 모바일 너비에서 열린다.
* 전화번호 + 비밀번호 로그인 / 로그아웃이 동작한다.
* 미로그인, 비활성, 기간 만료 사용자는 업무 화면을 쓰지 못한다.
* 브라우저 번들에 Secret / service_role key가 없다.
* 운영 도메인 설정 구조는 `https://app.ajumsocks.co.kr` 을 기준으로 한다.

---

# 3. Phase 0에서 하지 않는 것

* 행사 / 준비물 / 상품 / 재고 / 매출 / 지출 기능
* 직원/알바 생성 UI
* 초대링크 생성·검증·최초 비밀번호 설정 UI
* 공개 Sign Up
* SMS OTP / SMS Provider
* Social / Google / Apple Login
* 6자리 PIN / MFA / 이메일 회원가입
* Native App
* Storage bucket 생성
* Dashboard Schema 변경
* `service_role`을 브라우저에 넣기

---

# 4. 로컬 / 원격

```text
프로젝트 이름: ajumsocks
로컬 Postgres DB 이름: postgres (변경하지 않음)
앱 Schema: public
운영 앱 URL: https://app.ajumsocks.co.kr
로컬 앱 URL: http://127.0.0.1:5173
```

로컬:

```text
npx supabase start
```

원격:

```text
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```

Auth site URL 운영값:

```text
https://app.ajumsocks.co.kr
```

로컬 `config.toml`은 개발 주소를 쓰고, 운영 프로젝트 설정은 hosted Dashboard에서 동일 도메인을 넣는다.

---

# 5. 디렉터리

```text
ajumsocks/
├─ app/
├─ scripts/                     로컬 Auth seed (service_role, Node)
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/
│  └─ seed.sql
├─ docs/
├─ .env.example
└─ package.json
```

---

# 6. profiles Schema

```text
id                   uuid PK = auth.users.id
role                 ADMIN | STAFF | PART_TIMER
display_name         text
phone                text unique   -- E.164, 예 +821012345678
is_master            boolean
is_active            boolean
login_allowed_from   timestamptz   -- null이면 시작 제한 없음
login_allowed_until  timestamptz   -- null이면 종료 제한 없음
created_at           timestamptz
updated_at           timestamptz
```

제약:

* `is_master = true` 인 행은 하나
* MASTER는 반드시 `role = ADMIN`
* 공개 Sign Up 없음 (`enable_signup = false`)

접근 허용:

```text
is_active = true
AND (login_allowed_from  is null OR now() >= login_allowed_from)
AND (login_allowed_until is null OR now() <= login_allowed_until)
```

---

# 7. Auth 구조

* 공개 `signUp` 사용 안 함
* 로그인: 화면은 전화번호 + 비밀번호. Auth identity는 SMS 없이 동작하도록 정규화된 전화번호를 `users.local.ajumsocks` 이메일로 매핑한다. 사용자는 이메일을 입력하지 않는다.
* 전화번호 정규화 후 Auth phone과 비교
* 세션은 `@supabase/supabase-js` (anon key)
* Auth 성공 후 `profiles` 검사, 실패 시 업무 진입 거부
* 사용자 생성은 로컬 스크립트 또는 (Phase 1) Edge Function만

로컬 개발 계정은 `scripts/provision-local-users.mjs`가 service_role로 만든다.
이 스크립트는 브라우저에 포함되지 않는다.

---

# 8. RLS / MASTER 보호

공통 함수:

* `public.has_app_access()`
* `public.current_app_role()`
* `public.is_admin_user()`
* `public.is_master_user()`

업무 테이블(이후 Phase)은 `has_app_access()`를 기본 using/check로 쓴다.

MASTER 보호:

* `is_master` 행 삭제 금지 (authenticated)
* 역할 강등 / 비활성화 / `is_master` 해제 금지 (authenticated)
* trigger + RLS로 UI 우회를 막음
* service_role만 비상 복구 가능

---

# 9. 초대 확장점 (설계만, Phase 1 구현)

테이블은 Phase 0에서 만들지 않는다.

예정:

```text
public.invites
  profile_id, token_hash, created_at, expires_at, used_at, revoked_at
```

경로:

```text
https://app.ajumsocks.co.kr/invite/{secure_token}
```

서버:

```text
supabase/functions/  아래에 Admin provisioning / invite Edge Function
```

Token은 hash만 저장. 원본은 응답 한 번만 반환.

---

# 10. Web / PWA

```text
Vite + React + TypeScript
vite-plugin-pwa
@supabase/supabase-js
```

Phase 0 화면:

* `/login` 전화번호 + 비밀번호
* `/` 가드된 홈 (표시명, 역할, 로그아웃, 행사 자리표시)
* 미로그인 → `/login`
* 비활성/만료 → 차단 안내 후 업무 데이터 없음

Sign Up 화면 없음. Invite 화면 없음.

---

# 11. 환경변수

앱 (`app/.env`, Git 금지):

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Hosted 신규 프로젝트는 `sb_publishable_...` 를 쓴다.

Edge Function / 로컬 Admin 스크립트만:

```text
SUPABASE_SECRET_KEY=
```

`VITE_` 접두사로 Secret Key를 노출하지 않는다.
Legacy `anon key` / `service_role key` 용어는 신규 코드의 기본 전제가 아니다.
PostgreSQL RLS role 이름 `anon` / `authenticated` 는 그대로 둔다.

로컬 개발 비밀번호:

```text
LOCAL_DEV_PASSWORD
```

환경변수로만 넣고 Git / production seed / client bundle에 넣지 않는다.

---

# 12. 테스트

1. `npx supabase db reset`
2. 로컬 사용자 provision
3. 미로그인으로 `/` 접근 → 로그인으로 이동
4. MASTER 로그인 → 홈
5. 비활성 사용자 로그인 → 차단
6. 기간 만료 사용자 로그인 → 차단
7. `npm --prefix app run build`
8. 번들에 service_role 문자열 없음
