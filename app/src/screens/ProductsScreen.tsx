import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { callProductAdmin } from "../lib/functions";
import {
  categoryLabel,
  COUNTRY_LABEL,
  formatPrice,
  type Category,
  type Color,
  type Product,
  type Size,
} from "../lib/products";

const empty = {
  name: "",
  primary_category_id: "",
  size_id: "",
  primary_color_id: "",
  manufacturer_name: "",
  wholesaler_name: "",
  country_of_origin: "",
  purchase_price: "",
  sale_price: "",
  memo: "",
};

export function ProductsScreen() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [colors, setColors] = useState<Color[]>([]);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sizeId, setSizeId] = useState("");
  const [colorId, setColorId] = useState("");
  const [active, setActive] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(next?: { q?: string; category_id?: string; size_id?: string; color_id?: string; active?: typeof active }) {
    const q = next?.q ?? query;
    const category_id = next?.category_id ?? categoryId;
    const size_id = next?.size_id ?? sizeId;
    const color_id = next?.color_id ?? colorId;
    const isActive = next?.active ?? active;
    const result = await callProductAdmin({
      action: "list-products",
      q: q || undefined,
      category_id: category_id || undefined,
      size_id: size_id || undefined,
      color_id: color_id || undefined,
      is_active: isActive === "ALL" ? undefined : isActive === "ACTIVE",
    });
    setProducts((result.products ?? []) as Product[]);
  }

  useEffect(() => {
    void (async () => {
      try {
        const masters = await callProductAdmin({ action: "list-masters" });
        setCategories((masters.categories ?? []) as Category[]);
        setSizes((masters.sizes ?? []) as Size[]);
        setColors((masters.colors ?? []) as Color[]);
        await refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "불러오기 실패");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFilter() {
    setMessage(null);
    try {
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "검색 실패");
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const created = await callProductAdmin({
        action: "create",
        name: form.name,
        primary_category_id: form.primary_category_id || undefined,
        size_id: form.size_id || undefined,
        primary_color_id: form.primary_color_id || undefined,
        manufacturer_name: form.manufacturer_name || undefined,
        wholesaler_name: form.wholesaler_name || undefined,
        country_of_origin: form.country_of_origin || undefined,
        purchase_price: form.purchase_price || undefined,
        sale_price: form.sale_price || undefined,
        memo: form.memo || undefined,
        create_sku: Boolean(form.size_id || form.primary_color_id),
      });
      setForm(empty);
      await refresh();
      if (created.product?.id) {
        navigate(`/products/${created.product.id}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "등록 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell wide">
      <div className="nav-row">
        <Link to="/">← 홈</Link>
        <div className="brand">상품 관리</div>
      </div>
      <h1>상품 Master</h1>
      <p className="muted">필수 입력은 상품명입니다. Size/Color를 넣으면 기본 SKU가 함께 만들어집니다.</p>

      <form className="card" onSubmit={(event) => void onCreate(event)}>
        <h3 className="section-title">빠른 등록</h3>
        <label>상품명 *</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <div className="filters">
          <div>
            <label>분류</label>
            <select value={form.primary_category_id} onChange={(e) => setForm({ ...form, primary_category_id: e.target.value })}>
              <option value="">선택 안 함</option>
              {categories.filter((cat) => cat.is_active).map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {categoryLabel(categories, cat.id)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>제조국</label>
            <select value={form.country_of_origin} onChange={(e) => setForm({ ...form, country_of_origin: e.target.value })}>
              <option value="">선택 안 함</option>
              {Object.entries(COUNTRY_LABEL).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="filters">
          <div>
            <label>Size</label>
            <select value={form.size_id} onChange={(e) => setForm({ ...form, size_id: e.target.value })}>
              <option value="">선택 안 함</option>
              {sizes.filter((size) => size.is_active).map((size) => (
                <option key={size.id} value={size.id}>
                  {size.display_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Color</label>
            <select value={form.primary_color_id} onChange={(e) => setForm({ ...form, primary_color_id: e.target.value })}>
              <option value="">선택 안 함</option>
              {colors.filter((color) => color.is_active).map((color) => (
                <option key={color.id} value={color.id}>
                  {color.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="filters">
          <div>
            <label>제조사</label>
            <input value={form.manufacturer_name} onChange={(e) => setForm({ ...form, manufacturer_name: e.target.value })} />
          </div>
          <div>
            <label>도매사</label>
            <input value={form.wholesaler_name} onChange={(e) => setForm({ ...form, wholesaler_name: e.target.value })} />
          </div>
        </div>
        <div className="filters">
          <div>
            <label>매입가</label>
            <input type="number" min="0" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} />
          </div>
          <div>
            <label>판매가</label>
            <input type="number" min="0" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} />
          </div>
        </div>
        <label>메모</label>
        <textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
        {message ? <div className="error">{message}</div> : null}
        <button type="submit" disabled={busy}>
          빠른 등록
        </button>
      </form>

      <input
        className="search"
        placeholder="상품명, 상품코드, SKU 코드"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void onFilter();
        }}
      />
      <div className="filters product-filters">
        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            void refresh({ category_id: e.target.value });
          }}
        >
          <option value="">분류 전체</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {categoryLabel(categories, cat.id)}
            </option>
          ))}
        </select>
        <select
          value={sizeId}
          onChange={(e) => {
            setSizeId(e.target.value);
            void refresh({ size_id: e.target.value });
          }}
        >
          <option value="">Size 전체</option>
          {sizes.map((size) => (
            <option key={size.id} value={size.id}>
              {size.display_name}
            </option>
          ))}
        </select>
        <select
          value={colorId}
          onChange={(e) => {
            setColorId(e.target.value);
            void refresh({ color_id: e.target.value });
          }}
        >
          <option value="">Color 전체</option>
          {colors.map((color) => (
            <option key={color.id} value={color.id}>
              {color.name}
            </option>
          ))}
        </select>
        <select
          value={active}
          onChange={(e) => {
            const next = e.target.value as typeof active;
            setActive(next);
            void refresh({ active: next });
          }}
        >
          <option value="ALL">활성 전체</option>
          <option value="ACTIVE">활성</option>
          <option value="INACTIVE">비활성</option>
        </select>
      </div>
      <button className="secondary" type="button" onClick={() => void onFilter()}>
        검색
      </button>

      <div className="product-table-wrap">
        <table className="product-table">
          <thead>
            <tr>
              <th>사진</th>
              <th>상품명</th>
              <th>코드</th>
              <th>분류</th>
              <th>SKU</th>
              <th>판매가</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>
                  {product.primary_image_url ? (
                    <img className="thumb" src={product.primary_image_url} alt="" />
                  ) : (
                    <span className="thumb empty">-</span>
                  )}
                </td>
                <td>
                  <Link to={`/products/${product.id}`}>{product.name}</Link>
                </td>
                <td>{product.product_code}</td>
                <td>{product.category_name ?? "-"}</td>
                <td>{product.sku_count ?? 0}</td>
                <td>{formatPrice(product.sale_price)}</td>
                <td>{product.is_active ? "활성" : "비활성"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="product-cards">
        {products.map((product) => (
          <Link className="event-card-link" to={`/products/${product.id}`} key={product.id}>
            <article className="card product-card">
              {product.primary_image_url ? <img className="thumb" src={product.primary_image_url} alt="" /> : null}
              <strong>{product.name}</strong>
              <div>{product.product_code}</div>
              <div>{product.category_name ?? "분류 없음"} · SKU {product.sku_count ?? 0}</div>
              <div>{formatPrice(product.sale_price)}</div>
              <span className="badge">{product.is_active ? "활성" : "비활성"}</span>
            </article>
          </Link>
        ))}
      </div>
      {products.length === 0 ? <div className="placeholder">조건에 맞는 상품이 없습니다.</div> : null}
    </div>
  );
}
