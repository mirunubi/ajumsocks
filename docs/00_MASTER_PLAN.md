# AjumSocks MASTER PLAN

본 문서는 AjumSocks 프로젝트의 **최상위 요구사항**이다.

하위 계획 문서, Cursor 작업지시, 코드, Database Schema는 이 문서를 우선한다.
이 문서와 충돌하는 구현은 잘못된 구현으로 본다.

한글 상호:

```text
아점양말 (아점삭스)
```

시스템/프로젝트 이름:

```text
ajumsocks
```

`ajumsocks`는 **hosted Supabase 프로젝트 이름**이다. 사용자에게 보이는 이름은 **아점양말 / 아점삭스**다.
원격 PostgreSQL의 실제 Database 이름을 `ajumsocks`로 바꾸지 않는다.

운영 Web/PWA 주소:

```text
https://app.ajumsocks.co.kr
```

---

# 1. 프로젝트 방향

아점양말(아점삭스)은 행사장 직원·아르바이트가 초대 후 전화번호와 비밀번호로 접속해 업무를 처리할 수 있는 **내부 운영 시스템**이다.

공개 회원가입 시스템이 아니다. 사용자는 반드시 ADMIN이 먼저 등록해야 한다.

1차 사용 방식 (초대는 Phase 1):

```text
ADMIN이 직원/알바 등록
        ↓
일회성 초대 링크를 카카오톡/문자로 전달
        ↓
비밀번호 설정 (최초 활성화)
        ↓
이후 https://app.ajumsocks.co.kr
        ↓
전화번호 + 비밀번호 로그인
        ↓
배정된 행사 화면
```

여사장님은 홈 화면에 추가해 거의 앱처럼 계속 사용하고, 단기 아르바이트는 별도 설치 없이 웹으로 접속한다.

1차 Client는 Android/iOS Native App이 아니라 **모바일 우선 Web App / PWA**다.

```text
PWA  →  hosted Supabase project "ajumsocks"
              ├─ Auth
              ├─ Storage
              └─ Postgres + RLS
```

나중에 Native App이 필요해지면 같은 Supabase 프로젝트에 붙인다.

재고·상품·행사·발주 Logic을 Client마다 다시 만들지 않는다.

---

# 2. 개발 원칙

1. 초기부터 모든 미래 기능을 구현하지 않는다.
2. 다만 핵심 테이블을 전면 재설계하지 않도록 **관계만** 고려한다.
3. Database 구조 변경은 반드시 `supabase/migrations/*.sql`로 재현 가능해야 한다.
4. Dashboard에서 임의로 Schema를 변경한 뒤 Migration을 남기지 않는 방식은 금지한다.
5. 권한 판단은 Client UI가 아니라 **RLS + `profiles` 계층**에서 한다.
6. 운영 전화번호, 개인정보, DB Password, Secret / `service_role` Key를 Git Repository에 넣지 않는다.
7. Secret Key가 필요한 작업은 브라우저에서 실행하지 않는다.
8. MVP 단계에서 Android/iOS Native 코드를 만들지 않는다.
9. CatchMenu처럼 Supabase Docker를 직접 세세하게 커스터마이즈하지 않는다.
10. 로컬은 Supabase CLI 표준 스택을 쓰고, 검증된 Migration만 원격에 `db push`한다.
11. 공개 Sign Up과 SMS OTP는 MVP에서 구현하지 않는다.

향후 예상 기능은 구현하지 않되, 관계만 염두에 둔다.

* 행사별 보충요청
* 행사 간 재고이동
* 본사 재고
* 거래처 발주
* 입고
* 분할배송
* 제3지역 배송
* 사진검색
* 자동 발주추천

현재 사용하지 않는 컬럼이나 테이블을 미래 기능만을 위해 과도하게 생성하지 않는다.

---

# 3. 개발 및 실행환경

## 3.1 기본 개발환경

본 프로젝트는 **Supabase CLI + Docker** 로컬 환경을 기준으로 개발한다.

CatchMenu처럼 Docker Compose를 직접 조립하거나, 별도의 PostgreSQL Container를 또 만들지 않는다.

공식 흐름을 따른다.

```text
supabase init
    → supabase start
    → migration 작성
    → supabase db reset
    → supabase link
    → supabase db push
```

프로젝트 이름:

```text
ajumsocks
```

로컬에서 `supabase start`가 띄우는 Postgres Database 이름은 플랫폼 기본값인 `postgres`를 그대로 사용한다.
원격 hosted 프로젝트의 실제 Postgres DB 이름도 바꾸지 않는다.

애플리케이션 테이블은 그 프로젝트 안의 Schema(기본은 `public`)에 만든다.

기본구조:

```text
ajumsocks/
│
├─ app/                      Web/PWA
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/
│  └─ seed.sql
├─ docs/
│  ├─ 00_MASTER_PLAN.md
│  └─ 01_PHASE0_FOUNDATION_PLAN.md
└─ ...
```

개발 흐름:

```text
Cursor
  ↓
Local Supabase / Docker
  ↓
migration 작성
  ↓
로컬 db reset + 테스트
  ↓
Git commit
  ↓
Remote Supabase "ajumsocks"
  ↓
PWA (https://app.ajumsocks.co.kr)
  ↓
여사장 / 직원 / 행사 알바
```

---

## 3.2 Database / 프로젝트 이름

이름 규칙:

```text
프로젝트 이름: ajumsocks
실제 Postgres DB 이름: 플랫폼 기본값 (로컬은 postgres)
애플리케이션 Schema: public
운영 앱 도메인: https://app.ajumsocks.co.kr
```

잘못된 접근:

* 원격 Postgres DB 이름을 `ajumsocks`로 ALTER
* 로컬에 별도 Database `ajumsocks`를 만들고 Supabase 스택과 분리
* 개발/테스트/운영마다 DB 이름만 바꿔 같은 인스턴스를 공유

올바른 접근:

* 로컬: Supabase CLI가 띄운 로컬 프로젝트
* 원격 운영/테스트: hosted Supabase 프로젝트 `ajumsocks`
* 나중에 테스트 전용 원격이 필요하면 **별도 hosted 프로젝트**를 만든다

---

## 3.3 SQL Migration

Database 구조 변경은 반드시 SQL Migration 파일로 관리한다.

경로:

```text
supabase/migrations/
```

파일은 Supabase CLI가 생성하는 timestamp 접두사를 사용한다.

한번 적용된 Migration 파일은 가능한 한 수정하지 않는다.
변경이 필요한 경우 새로운 Migration을 추가한다.

Dashboard SQL Editor나 Studio GUI로 테이블을 만든 뒤 원본으로 쓰지 않는다.
스키마 원본은 Git의 `supabase/migrations/`이다.

---

## 3.4 DB 설계 원칙

초기부터 모든 미래 기능을 구현하지 않는다.

다만 다음 기능을 추가할 때 기존 핵심 테이블을 전면 재설계하지 않도록 관계만 고려한다.

모든 업무 테이블은 처음부터 RLS를 켠다.

---

## 3.5 개발용 Seed Data

개발과 테스트를 위해 최소 Seed 데이터를 제공한다.

공식 경로:

```text
supabase/seed.sql
```

로그인 가능한 Auth 사용자는 로컬 전용 스크립트가 Auth Admin API(service_role)로 만든다.
브라우저에서 만들지 않는다.

MASTER 계정은 개발환경에서 생성할 수 있다.

실제 운영 전화번호나 개인정보를 Git Repository에 저장하지 않는다.
원격 운영 DB에는 `--include-seed`를 사용하지 않는다.

---

## 3.6 Backup / Storage

사진 원본은 PostgreSQL에 binary로 넣지 않는다.

```text
파일        → Supabase Storage
경로/메타데이터 → Postgres
```

백업은 우선 Supabase 플랫폼 백업과 CLI dump를 사용한다.

---

## 3.7 1차 Client 전략

1차 Client는 **모바일 Web App / PWA**다.

MVP 기본방향:

```text
Responsive Web
        +
       PWA
```

운영 주소는 `https://app.ajumsocks.co.kr` 이다.
`www.ajumsocks.co.kr` / `ajumsocks.co.kr` 은 별도 홈페이지용으로 남겨 둔다.

---

## 3.8 PWA 사용 시나리오

아르바이트가 카카오톡 또는 문자로 초대 링크를 전달받는다. (Phase 1)

↓

비밀번호 설정

↓

이후 `https://app.ajumsocks.co.kr` 접속

↓

전화번호 + 비밀번호 로그인

↓

본인에게 배정된 행사 확인

↓

행사정보 / 사진 / 준비물 / 재고 실사 / 매출·지출

별도의 앱스토어 설치가 없어도 업무가 가능하도록 하는 것이 1차 목표다.

SMS OTP는 MVP에서 사용하지 않는다.
ajumsocks 자체가 SMS를 발송하지 않는다.

---

## 3.9 Native App 개발 판단

오프라인 장시간 사용, 백그라운드 동기화, 고도화된 카메라/바코드/Bluetooth 등이 명확해지기 전에는 Native App을 개발하지 않는다.

필요해지면 Android → iOS 순이다.

---

## 3.10 권장 전체 구조

```text
[Android / iPhone / PC Browser]
              │
              ▼
       [Web App / PWA]
       app.ajumsocks.co.kr
              │
              ▼
     [hosted Supabase "ajumsocks"]
              ├─ Auth
              ├─ Storage
              ├─ Postgres + RLS
              └─ Edge Functions (Admin/초대, Phase 1)
```

사진:

```text
Web App
   │
   ├─ Metadata → Postgres
   │
   └─ Image File → Supabase Storage
```

브라우저에는 Publishable / anon key만 둔다.
Auth Admin API, 계정 Provisioning, Secret Key 작업은 Server-side 또는 Edge Function에서만 한다.

---

## 3.11 인증 정책

ajumsocks는 공개 회원가입 시스템이 아니다.

허용 역할:

* ADMIN
* STAFF
* PART_TIMER

등록되지 않은 전화번호는 스스로 회원가입할 수 없다.

MVP 로그인:

```text
전화번호 + 비밀번호
```

SMS OTP는 현재 구현하지 않는다. 향후 별도 Phase에서 추가할 수 있다.

비밀번호는 최소 8자 이상이다. 6자리 PIN만 쓰는 방식은 구현하지 않는다.

전화번호는 입력 시 하이픈을 허용하되, 내부적으로 E.164 형식으로 정규화한다.

예:

```text
입력: 010-1234-5678
내부: +821012345678
Auth identity: 821012345678@users.local.ajumsocks
```

사용자는 이메일을 입력하지 않는다. SMS Provider 없이 전화번호+비밀번호를 쓰기 위한 매핑이며, 공개 이메일 회원가입이 아니다.

### 사용자 생성

사용자가 직접 Sign Up하는 기능/페이지/API를 제공하지 않는다.

```text
ADMIN 로그인
  → 직원/알바 생성
  → 이름, 전화번호, 역할
  → 로그인 허용 시작일 / 종료일
  → 담당 행사는 Phase 1 이후 연결
  → 초대 생성
```

이 UI와 Provisioning은 **Phase 1**이다.

### 초대 (Phase 1)

등록 후 일회성 초대 링크를 만들 수 있는 구조로 설계한다.

예:

```text
https://app.ajumsocks.co.kr/invite/{secure_token}
```

ADMIN이 카카오톡/문자 등 기존 연락수단으로 직접 전달한다.
MVP에서 SMS Provider를 연결하지 않는다.

Token:

* Cryptographically Secure Random
* DB에는 원본이 아니라 `token_hash` 저장
* 일회용, 만료, 사용 후 재사용 불가, ADMIN 취소 가능
* Token 유출이 영구 로그인 수단이 되면 안 된다

속성:

* user/profile reference
* token_hash
* created_at
* expires_at
* used_at
* revoked_at

알바가 링크를 열면:

```text
Token 검증
  → 이름/전화 일부 마스킹 표시
  → 비밀번호 설정
  → Auth 계정 활성화/연결
  → 초대 사용완료
  → 로그인
```

### Auth Admin 보안

다음 작업은 브라우저에서 실행하지 않는다.

* Auth User 생성
* Auth User 관리
* 초대에 따른 계정 Provisioning
* Secret Key가 필요한 작업

Browser에는 Publishable Key만 존재해야 한다.

Secret Key / Service Role 계열 Key를 Vite 환경변수, Browser bundle, Git, Client source에 넣지 않는다.

### 로그인 후 접근조건

Supabase Auth 성공만으로 업무권한을 부여하지 않는다.

`profiles` 기준:

```text
is_active = true
AND (now() >= login_allowed_from OR 시작일 NULL)
AND (now() <= login_allowed_until OR 종료일 NULL)
```

이 검사는 UI와 RLS(또는 서버 권한검사)에 동일하게 적용한다.
Auth Session이 남아 있어도 기간이 끝나면 업무 데이터 접근은 차단된다.

### 재고용

PART_TIMER는 행사 종료 후 삭제하지 않는다.
계정을 남기고, 나중에 로그인 허용기간과 행사 배정만 갱신한다.
과거 행사이력은 유지한다.
비밀번호 재설정 / 재초대는 향후 ADMIN 기능으로 확장한다.

### MASTER 계정

최초 대표자 계정은 `is_master = true` 이다.
MASTER는 ADMIN 권한을 가진다.

일반 ADMIN 화면에서 MASTER를:

* 삭제
* 비활성화
* 역할 강등

할 수 없다. UI 차단만으로 처리하지 않고 DB/RLS 또는 서버측에서도 보호한다.

### MVP에서 구현하지 않는 인증

* SMS OTP
* SMS Provider 연결
* 공개 Sign Up
* Social Login
* Google / Apple Login
* 6자리 단순 PIN
* MFA
* 이메일 회원가입

---

## 3.12 Hosted / Local

Local:

```text
Supabase CLI + Docker
```

Remote:

```text
hosted Supabase project ajumsocks
```

Schema Source of Truth:

```text
supabase/migrations/
```

Dashboard에서 임의로 Schema를 변경하지 않는다.

Supabase Auth redirect / site URL 운영 설정은 `https://app.ajumsocks.co.kr` 을 기준으로 한다.

Local `enable_signup = false` 만으로 hosted 공개가입이 꺼졌다고 보지 않는다.

원격 확인:

1. Dashboard → Authentication → Providers → Email → **Allow new users to sign up = OFF**
2. Phone signup OFF
3. Site URL = `https://app.ajumsocks.co.kr`

---

## 3.13 Phase 범위

### Phase 0

* Local Supabase 환경
* Vite + React + TypeScript
* PWA 기반구조
* Supabase Client (Publishable Key only)
* profiles
* ADMIN / STAFF / PART_TIMER
* is_master / is_active
* login_allowed_from / login_allowed_until
* 로그인 / 로그아웃
* 인증 Route Guard
* RLS 공통 권한기반
* MASTER 보호 기반
* `app.ajumsocks.co.kr` 운영환경 설정 구조
* 초대 시스템을 붙일 DB/Auth 확장점과 Server-side 경계 설계

Phase 0에서 Phase 1 UI를 선행구현하지 않는다.

### Phase 1

* 직원/알바 생성 UI
* Auth User Provisioning (서버)
* 일회성 초대링크 생성
* 초대링크 검증
* 최초 비밀번호 설정
* 재초대 / 초대취소

---

## 3.14 Cursor에게 금지할 사항

* Dashboard에서만 테이블 생성
* Migration 없는 Schema 변경
* 원격 Postgres DB 이름을 `ajumsocks`로 변경
* 별도의 커스텀 PostgreSQL Docker Compose를 추가로 만들기
* CatchMenu식 Supabase Docker 세세한 커스터마이즈
* 개발자 PC에서만 동작하는 절대경로 사용
* 운영 전화번호 Hard Coding
* DB Password / Secret Key Repository Commit 또는 Vite/브라우저 포함
* Client에서 직접 관리자 권한 판단
* UI에만 접근권한 적용
* RLS 없이 업무 테이블 공개
* 공개 Sign Up 페이지/API
* MVP에서 SMS OTP 구현
* 사진을 Postgres bytea/blob로 저장
* Android/iOS 코드를 MVP 단계에서 동시에 생성
* Phase 0 완료 후 승인 없이 Phase 1 시작

---

## 3.15 스택 결정

쓰는 것:

* Supabase CLI + Docker (로컬)
* hosted Supabase 프로젝트 `ajumsocks` (원격)
* Supabase Auth (전화번호 + 비밀번호)
* Postgres + RLS
* `supabase/migrations`
* Vite + React + TypeScript PWA
* 서버측 Edge Function (Phase 1 Admin/초대)

쓰지 않는 것:

* 자체 Auth 서버
* MVP SMS OTP
* 공개 Sign Up
* Client 단독 권한 판단
* CatchMenu식 Docker 커스터마이즈

---

# 4. 다음 작업

Phase 0 구현 완료 후 완료보고를 하고 정지한다.
Phase 1은 승인 없이 시작하지 않는다.
