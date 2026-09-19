import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { callAssortmentAdmin } from "../lib/functions";
import {
  type AssortmentSet,
  type EventAssortment,
  type EventAssortmentItem,
  type PreviewSku,
} from "../lib/assortment";

const PAGE = 40;

export function EventAssortmentPanel({ eventId, isAdmin }: { eventId: string; isAdmin: boolean }) {
  const [assortment, setAssortment] = useState<EventAssortment | null>(null);
  const [items, setItems] = useState<EventAssortmentItem[]>([]);
  const [sets, setSets] = useState<AssortmentSet[]>([]);
  const [setId, setSetId] = useState("");
  const [preview, setPreview] = useState<{ sku_count: number; skus: PreviewSku[] } | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [size, setSize] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [skuQuery, setSkuQuery] = useState("");
  const [skuHits, setSkuHits] = useState<PreviewSku[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await callAssortmentAdmin({ action: "get-event", event_id: eventId });
    setAssortment((result.assortment ?? null) as EventAssortment | null);
    setItems((result.items ?? []) as EventAssortmentItem[]);
  }, [eventId]);

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [refresh]);

  useEffect(() => {
    if (!isAdmin) return;
    void callAssortmentAdmin({ action: "list-sets" })
      .then((result) => setSets(((result.sets ?? []) as AssortmentSet[]).filter((row) => row.is_active)))
      .catch((error: Error) => setMessage(error.message));
  }, [isAdmin]);

  const active = useMemo(() => items.filter((item) => !item.removed_at), [items]);
  const categories = useMemo(
    () => [...new Set(active.map((item) => item.category_snapshot || "미분류"))],
    [active],
  );
  const sizes = useMemo(
    () => [...new Set(active.map((item) => item.size_snapshot).filter(Boolean))] as string[],
    [active],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return active.filter((item) => {
      if (category && (item.category_snapshot || "미분류") !== category) return false;
      if (size && item.size_snapshot !== size) return false;
      if (!q) return true;
      return (
        item.product_name_snapshot.toLowerCase().includes(q) ||
        item.product_code_snapshot.toLowerCase().includes(q) ||
        item.sku_code_snapshot.toLowerCase().includes(q)
      );
    });
  }, [active, query, category, size]);

  const grouped = useMemo(() => {
    const map = new Map<string, EventAssortmentItem[]>();
    for (const item of filtered) {
      const key = item.category_snapshot || "미분류";
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered]);

  async function onPreview(event: FormEvent) {
    event.preventDefault();
    if (!setId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await callAssortmentAdmin({ action: "preview", assortment_set_id: setId });
      setPreview({ sku_count: result.sku_count as number, skus: (result.skus ?? []) as PreviewSku[] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "미리보기 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onApply() {
    if (!setId) return;
    setBusy(true);
    setMessage(null);
    try {
      await callAssortmentAdmin({ action: "apply-to-event", event_id: eventId, assortment_set_id: setId });
      setPreview(null);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "적용 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onSearchSku() {
    setBusy(true);
    try {
      const result = await callAssortmentAdmin({ action: "search-skus", q: skuQuery });
      setSkuHits((result.skus ?? []) as PreviewSku[]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "검색 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(variantId: string) {
    setBusy(true);
    setMessage(null);
    try {
      await callAssortmentAdmin({ action: "add-event-item", event_id: eventId, product_variant_id: variantId });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "추가 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string) {
    setBusy(true);
    try {
      await callAssortmentAdmin({ action: "remove-event-item", id });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "제외 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="section-title tight">상품구성</h2>
      <p className="muted">취급 SKU 범위입니다. 재고 수량은 표시하지 않습니다.</p>
      {message ? <div className="error">{message}</div> : null}

      {!assortment && isAdmin ? (
        <form onSubmit={(event) => void onPreview(event)}>
          <select value={setId} onChange={(e) => { setSetId(e.target.value); setPreview(null); }}>
            <option value="">상품구성 세트 선택</option>
            {sets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy || !setId}>
            Preview
          </button>
        </form>
      ) : null}

      {preview ? (
        <>
          <p>포함 예정 {preview.sku_count} SKU</p>
          {preview.skus.slice(0, 8).map((sku) => (
            <div className="muted" key={sku.product_variant_id}>
              {sku.product_name} · {sku.sku_code}
            </div>
          ))}
          {preview.sku_count > 8 ? <p className="muted">외 {preview.sku_count - 8}개</p> : null}
          <button type="button" disabled={busy} onClick={() => void onApply()}>
            이 구성 적용
          </button>
        </>
      ) : null}

      {assortment ? (
        <>
          <p>
            <strong>{active.length} SKU</strong>
          </p>
          <input
            className="search"
            placeholder="상품명, 코드, SKU"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="filters">
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">분류 전체</option>
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="">Size 전체</option>
              {sizes.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          {grouped.map(([group, rows]) => {
            const open = openGroups[group] ?? false;
            const shown = open ? rows.slice(0, PAGE) : [];
            return (
              <div key={group}>
                <button
                  className="chip"
                  type="button"
                  onClick={() => setOpenGroups((prev) => ({ ...prev, [group]: !open }))}
                >
                  {open ? "▾" : "▸"} {group} ({rows.length})
                </button>
                {shown.map((item) => (
                  <div className="stack-row" key={item.id}>
                    <div>
                      <strong>{item.product_name_snapshot}</strong>
                      <div className="muted">
                        {item.sku_code_snapshot} · {item.size_snapshot ?? "-"} / {item.color_snapshot ?? "-"}
                        {item.source_type === "MANUAL" ? " · 수동" : ""}
                      </div>
                    </div>
                    {isAdmin ? (
                      <button className="tiny danger" type="button" disabled={busy} onClick={() => void onRemove(item.id)}>
                        제외
                      </button>
                    ) : null}
                  </div>
                ))}
                {open && rows.length > PAGE ? <p className="muted">검색으로 더 좁히세요. ({rows.length}개)</p> : null}
              </div>
            );
          })}

          {isAdmin ? (
            <div>
              <h3 className="section-title">SKU 수동 추가</h3>
              <div className="qty-row">
                <input value={skuQuery} onChange={(e) => setSkuQuery(e.target.value)} placeholder="상품명 또는 코드" />
                <button className="tiny" type="button" disabled={busy} onClick={() => void onSearchSku()}>
                  찾기
                </button>
              </div>
              {skuHits.map((sku) => (
                <div className="stack-row" key={sku.product_variant_id}>
                  <div>
                    {sku.product_name} · {sku.sku_code}
                  </div>
                  <button className="tiny" type="button" disabled={busy} onClick={() => void onAdd(sku.product_variant_id)}>
                    추가
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : !isAdmin ? (
        <p className="muted">아직 상품구성이 없습니다.</p>
      ) : null}
    </section>
  );
}
