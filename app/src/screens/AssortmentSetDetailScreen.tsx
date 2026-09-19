import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { callAssortmentAdmin, callProductAdmin } from "../lib/functions";
import { ruleSummary, type AssortmentRule, type AssortmentSet, type PreviewSku } from "../lib/assortment";
import { categoryLabel, type Category, type Color, type Size, type Tag } from "../lib/products";

export function AssortmentSetDetailScreen() {
  const { id = "" } = useParams();
  const [setRow, setSetRow] = useState<AssortmentSet | null>(null);
  const [rules, setRules] = useState<AssortmentRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [colors, setColors] = useState<Color[]>([]);
  const [form, setForm] = useState({
    category_id: "",
    include_descendants: true,
    tag_id: "",
    size_id: "",
    color_id: "",
  });
  const [preview, setPreview] = useState<{ sku_count: number; skus: PreviewSku[] } | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const [payload, masters] = await Promise.all([
      callAssortmentAdmin({ action: "get-set", id }),
      callProductAdmin({ action: "list-masters" }),
    ]);
    setSetRow(payload.set as AssortmentSet);
    setRules((payload.rules ?? []) as AssortmentRule[]);
    setCategories((masters.categories ?? []) as Category[]);
    setTags((masters.tags ?? []) as Tag[]);
    setSizes((masters.sizes ?? []) as Size[]);
    setColors((masters.colors ?? []) as Color[]);
  }

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [id]);

  const labels = useMemo(
    () => ({
      category: (cid: string | null) => categoryLabel(categories, cid),
      tag: (tid: string | null) => tags.find((row) => row.id === tid)?.name ?? tid ?? "-",
      size: (sid: string | null) => sizes.find((row) => row.id === sid)?.display_name ?? sid ?? "-",
      color: (cid: string | null) => colors.find((row) => row.id === cid)?.name ?? cid ?? "-",
    }),
    [categories, tags, sizes, colors],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, PreviewSku[]>();
    for (const sku of preview?.skus ?? []) {
      const key = sku.category_path || "미분류";
      const list = map.get(key) ?? [];
      list.push(sku);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [preview]);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await callAssortmentAdmin({
        action: "add-rule",
        assortment_set_id: id,
        ...form,
        category_id: form.category_id || null,
        tag_id: form.tag_id || null,
        size_id: form.size_id || null,
        color_id: form.color_id || null,
      });
      setForm({ category_id: "", include_descendants: true, tag_id: "", size_id: "", color_id: "" });
      setPreview(null);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rule 추가 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onPreview() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await callAssortmentAdmin({ action: "preview", assortment_set_id: id });
      setPreview({ sku_count: result.sku_count as number, skus: (result.skus ?? []) as PreviewSku[] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Preview 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(ruleId: string) {
    setBusy(true);
    try {
      await callAssortmentAdmin({ action: "remove-rule", id: ruleId });
      setPreview(null);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  if (!setRow) {
    return (
      <div className="app-shell">
        <p className="muted">{message ?? "불러오는 중..."}</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to="/assortment-sets">← 세트</Link>
        <div className="brand">Rule 편집</div>
      </div>
      <h1>{setRow.name}</h1>
      {setRow.description ? <p className="muted">{setRow.description}</p> : null}
      {message ? <div className="error">{message}</div> : null}

      {rules.map((rule) => (
        <article className="card" key={rule.id}>
          <strong>{ruleSummary(rule, labels)}</strong>
          <button className="tiny danger" type="button" disabled={busy} onClick={() => void onRemove(rule.id)}>
            삭제
          </button>
        </article>
      ))}

      <form className="card" onSubmit={(event) => void onAdd(event)}>
        <h3 className="section-title">Rule 추가</h3>
        <p className="muted">한 Rule 안은 AND, 여러 Rule은 OR 입니다.</p>
        <label>Category</label>
        <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
          <option value="">선택 안 함</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {categoryLabel(categories, cat.id)}
            </option>
          ))}
        </select>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.include_descendants}
            onChange={(e) => setForm({ ...form, include_descendants: e.target.checked })}
          />
          하위 분류 포함
        </label>
        <label>Tag</label>
        <select value={form.tag_id} onChange={(e) => setForm({ ...form, tag_id: e.target.value })}>
          <option value="">선택 안 함</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
        <div className="filters">
          <select value={form.size_id} onChange={(e) => setForm({ ...form, size_id: e.target.value })}>
            <option value="">Size 전체</option>
            {sizes.map((size) => (
              <option key={size.id} value={size.id}>
                {size.display_name}
              </option>
            ))}
          </select>
          <select value={form.color_id} onChange={(e) => setForm({ ...form, color_id: e.target.value })}>
            <option value="">Color 전체</option>
            {colors.map((color) => (
              <option key={color.id} value={color.id}>
                {color.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={busy}>
          Rule 추가
        </button>
      </form>

      <button className="secondary" type="button" disabled={busy} onClick={() => void onPreview()}>
        후보 SKU Preview
      </button>
      {preview ? (
        <section className="card">
          <h3 className="section-title">Preview {preview.sku_count} SKU</h3>
          {grouped.map(([group, rows]) => (
            <div key={group}>
              <button
                className="chip"
                type="button"
                onClick={() => setOpenGroups((prev) => ({ ...prev, [group]: !prev[group] }))}
              >
                {openGroups[group] ? "▾" : "▸"} {group} ({rows.length})
              </button>
              {openGroups[group]
                ? rows.map((sku) => (
                  <div className="stack-row" key={sku.product_variant_id}>
                    <div>
                      <strong>{sku.product_name}</strong>
                      <div className="muted">
                        {sku.sku_code} · {sku.size_name ?? "-"} / {sku.color_name ?? "-"}
                      </div>
                    </div>
                  </div>
                ))
                : null}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
