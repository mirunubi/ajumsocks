import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { callInventoryMovement } from "../lib/functions";
import { REMAINDER_OPTIONS, stockLabel, type RemainderLevel } from "../lib/inventory";
import { LOCATION_TYPE_LABEL, approxLabel, type InventoryLocation } from "../lib/movement";

type StockRow = {
  id: string;
  product_variant_id: string;
  estimated_units: number;
  product_name: string;
  sku_code: string;
  size_name: string | null;
  color_name: string | null;
  category_name: string | null;
};

type SkuHit = {
  product_variant_id: string;
  product_name: string;
  sku_code: string;
};

export function LocationStockScreen() {
  const { id = "" } = useParams();
  const [location, setLocation] = useState<InventoryLocation | null>(null);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [adjustments, setAdjustments] = useState<Array<{ id: string; before_estimated_units: number | null; after_estimated_units: number; reason: string }>>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [skuQuery, setSkuQuery] = useState("");
  const [hits, setHits] = useState<SkuHit[]>([]);
  const [variantId, setVariantId] = useState("");
  const [full, setFull] = useState(0);
  const [remainder, setRemainder] = useState<RemainderLevel>("HALF");
  const [reason, setReason] = useState("실물확인");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await callInventoryMovement({ action: "get-location-stock", id });
    setLocation(result.location as InventoryLocation);
    setStock((result.stock ?? []) as StockRow[]);
    setAdjustments(result.adjustments ?? []);
  }, [id]);

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [refresh]);

  const categories = [...new Set(stock.map((row) => row.category_name || "미분류"))];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stock.filter((row) => {
      if (category && (row.category_name || "미분류") !== category) return false;
      if (!q) return true;
      return row.product_name.toLowerCase().includes(q) || row.sku_code.toLowerCase().includes(q);
    });
  }, [stock, query, category]);

  async function searchSku() {
    const result = await callInventoryMovement({ action: "search-skus", q: skuQuery });
    setHits((result.skus ?? []) as SkuHit[]);
  }

  async function onAdjust() {
    if (!variantId) return;
    setBusy(true);
    setMessage(null);
    try {
      await callInventoryMovement({
        action: "create-adjustment",
        location_id: id,
        product_variant_id: variantId,
        full_pack_count: full,
        remainder_level: remainder,
        reason,
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "맞추기 실패");
    } finally {
      setBusy(false);
    }
  }

  if (!location) {
    return (
      <div className="app-shell">
        <p className="muted">{message ?? "불러오는 중..."}</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to="/locations">← 재고 위치</Link>
        <div className="brand">{LOCATION_TYPE_LABEL[location.location_type]}</div>
      </div>
      <h1>{location.name}</h1>
      {message ? <div className="error">{message}</div> : null}
      <input className="search" placeholder="상품명, SKU" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">분류 전체</option>
        {categories.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {filtered.map((row) => (
        <article className="stack-row" key={row.id}>
          <div>
            <strong>{row.product_name}</strong>
            <div className="muted">
              {row.sku_code} · {row.size_name ?? "-"} / {row.color_name ?? "-"}
            </div>
            <div>{approxLabel(row.estimated_units)}</div>
          </div>
        </article>
      ))}

      <h2 className="section-title">현재 재고로 맞추기</h2>
      <input placeholder="상품 검색" value={skuQuery} onChange={(e) => setSkuQuery(e.target.value)} />
      <button className="secondary" type="button" onClick={() => void searchSku()}>
        검색
      </button>
      {hits.map((hit) => (
        <button key={hit.product_variant_id} className="stack-row" type="button" onClick={() => setVariantId(hit.product_variant_id)}>
          {hit.product_name} · {hit.sku_code}
          {variantId === hit.product_variant_id ? " ✓" : ""}
        </button>
      ))}
      <div className="stepper">
        <button className="stepper-btn" type="button" onClick={() => setFull((n) => Math.max(0, n - 1))}>
          −
        </button>
        <strong className="stepper-value">{full}</strong>
        <button className="stepper-btn" type="button" onClick={() => setFull((n) => n + 1)}>
          +
        </button>
      </div>
      <div className="remainder-row">
        {REMAINDER_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={remainder === option.id ? "remainder-btn active" : "remainder-btn"}
            onClick={() => setRemainder(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p>{stockLabel(full, remainder)}</p>
      <label>사유</label>
      <select value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="최초 인정">최초 인정</option>
        <option value="실물확인">실물확인</option>
        <option value="보정">보정</option>
      </select>
      <button type="button" disabled={busy || !variantId} onClick={() => void onAdjust()}>
        현재 재고로 맞추기
      </button>
      <h3 className="section-title">맞추기 이력</h3>
      {adjustments.map((row) => (
        <div className="stack-row" key={row.id}>
          {approxLabel(row.before_estimated_units)} → {approxLabel(row.after_estimated_units)} · {row.reason}
        </div>
      ))}
    </div>
  );
}
