# Phase 4 Product Master Plan

상태: **구현 기준**

상위 문서: `docs/00_MASTER_PLAN.md`
선행: Phase 0–3
충돌 시 MASTER PLAN을 우선한다.

한글 상호: **아점양말 (아점삭스)**

Phase 5 행사 상품구성, Phase 6 재고는 이 문서 범위가 아니다.

---

# 1. 목적

양말 상품의 표준 Master만 만든다. 재고·출고·발주·행사 구성은 하지 않는다.

재고의 미래 단위는 `product_variants.id` (SKU) 다.

---

# 2. 계층

고정 컬럼으로 모든 양말 특성을 넣지 않는다.

```text
Category (계층, 누구/대상)
Product  (공통 정보, 가격, 포장단위)
  SKU / Variant  (사이즈×색 조합, 불변 sku_code)
Attribute (함량, 형태, 색상유형)
Tag (기능·디자인, flat)
Image (Storage metadata)
Size / Color Master
```

---

# 3. 분류 원칙

**Category = 판매 대상**

```text
신생아
아동
성인
  ├─ 여성
  └─ 남성
```

**Size Master = 치수** (1호, M, L …). Category와 겹치지 않는다.  
`M=여성` 관행은 DB Constraint로 강제하지 않는다.

**Attribute `sock_style` SELECT = 상품 형태**

발가락 / 니삭스 / 덧신 / 중목 / 장목 / 파일양말

중목·장목을 Category에 넣지 않는다.

**Attribute `color_pattern` SELECT**

솔리드 / 혼합 / 멀티컬러  — Color Master에 넣지 않는다.

**소재 비율:** Attribute NUMBER + unit `%`  
(`cotton_pct`, `polyester_pct`, `polyurethane_pct`, `wool_pct`)  
조성 전용 엔진은 만들지 않는다.

**제조사/도매사:** Product text. Supplier 테이블 없음.  
**제조국:** `KR` `CN` `JP` `OTHER` text.

---

# 4. 코드

Product: `AJ-` + 6자리 일련 (`AJ-000001`). UNIQUE. 서버에서 발급.

SKU: `{product_code}-{nn}` (`AJ-000001-01`). UNIQUE, **불변**.  
Size/Color 이름을 코드에 넣지 않는다 (명칭 변경 시 코드가 따라가지 않게).

---

# 5. 테이블

* `products` — pack_quantity default **10** (컬럼 default, 앱 하드코딩 아님). price >= 0.
* `product_variants` — size_id / primary_color_id nullable
* `product_categories` — parent_id self FK
* `sizes`, `colors`
* `attribute_definitions` — TEXT / NUMBER / BOOLEAN / SELECT
* `product_attribute_values` — unique (product_id, attribute_definition_id)
* `tags`, `product_tags` — unique (product_id, tag_id). Tag는 flat. group 컬럼은 두지 않고 Extension Point만.
* `product_images` — metadata only

가격은 Product만. SKU override 없음.

물리 DELETE UI 없음. `is_active=false`.

대표사진: partial unique `(product_id) WHERE is_primary`.

---

# 6. Storage

Bucket `product-images`, path `{product_id}/{uuid}_{filename}`.

삭제: Storage 성공 후 DB row.

ADMIN만 업로드/삭제.  
READ: `has_app_access()` 인 authenticated (향후 알바 재고 입력).

---

# 7. RLS / Write

SELECT: `private.has_app_access()`  
기간만료·비활성은 거부.

Write: Edge Function `product-admin` + Secret Key. ADMIN만.  
Client SQL Write 패턴을 섞지 않는다.

---

# 8. 화면

`/products` 목록+빠른등록 (ADMIN)  
`/products/:id` 상세편집 (ADMIN)

필수: 상품명.  
권장: 분류, Size, Color → 기본 SKU 1개.  
Attribute/Tag/추가 SKU/사진은 상세에서.

검색: 상품명, product_code, sku_code (ilike).  
필터: category, size, color, active.

---

# 9. Seed

Migration에 Size/Color/Category/최소 Tag·Attribute 정의만.  
운영 상품·가격 Seed 없음.

---

# 10. MASTER PLAN / Phase 0–3 충돌 검토

| 항목 | 결과 |
|---|---|
| 행사 구성/재고 아직 없음 | 유지 |
| 준비물과 상품 분리 | 유지. `preparation_*` 재사용 안 함 |
| Write = Edge Function | `product-admin` |
| Storage metadata only | 유지 |
| 알바 조회는 has_app_access | 재고 Phase를 위한 READ |
| Embedding/vector 없음 | 유지 |

충돌 없음.

---

# 11. Phase 5 Extension Point

행사 상품구성은 `event_id` + `product_variant_id` + 수량.  
Product Master를 행사에 live join하지 말고 구성 Snapshot을 검토한다 (준비물과 같은 원칙).
