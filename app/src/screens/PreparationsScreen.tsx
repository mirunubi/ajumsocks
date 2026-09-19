import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { callPrepAdmin } from "../lib/functions";
import { ITEM_TYPE_LABEL, type ItemType, type PreparationItem } from "../lib/preparation";

const empty = {
  name: "",
  item_type: "EQUIPMENT" as ItemType,
  default_unit: "개",
  requires_return: true,
  memo: "",
};

export function PreparationsScreen() {
  const [items, setItems] = useState<PreparationItem[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const result = await callPrepAdmin({ action: "list-items" });
    setItems((result.items ?? []) as PreparationItem[]);
  }

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim();
    return items.filter((item) => !q || item.name.includes(q));
  }, [items, query]);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await callPrepAdmin({
        action: "upsert-item",
        id: editing,
        ...form,
        requires_return: form.item_type === "EQUIPMENT" ? form.requires_return : false,
      });
      setForm(empty);
      setEditing(null);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onDeactivate(item: PreparationItem) {
    setBusy(true);
    try {
      await callPrepAdmin({ action: "upsert-item", ...item, is_active: false });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "비활성화 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to="/">← 홈</Link>
        <div className="brand">준비물 관리</div>
      </div>
      <h1>준비물 관리</h1>
      <p className="muted">판매상품이 아닙니다. 랙, 조명, 쇼핑백 같은 집기/소모품만 등록합니다.</p>
      <Link className="primary-link" to="/preparation-sets">
        준비물 세트
      </Link>
      <form className="card" onSubmit={(event) => void onSave(event)}>
        <label>이름</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <label>종류</label>
        <select
          value={form.item_type}
          onChange={(e) => {
            const item_type = e.target.value as ItemType;
            setForm({ ...form, item_type, requires_return: item_type === "EQUIPMENT" });
          }}
        >
          <option value="EQUIPMENT">집기</option>
          <option value="CONSUMABLE">소모품</option>
        </select>
        <label>단위</label>
        <input value={form.default_unit} onChange={(e) => setForm({ ...form, default_unit: e.target.value })} required />
        {form.item_type === "EQUIPMENT" ? (
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.requires_return}
              onChange={(e) => setForm({ ...form, requires_return: e.target.checked })}
            />
            회수 필요
          </label>
        ) : (
          <p className="muted">소모품은 회수를 강제하지 않습니다.</p>
        )}
        <label>메모</label>
        <textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
        {message ? <div className="error">{message}</div> : null}
        <button type="submit" disabled={busy}>
          {editing ? "수정 저장" : "준비물 등록"}
        </button>
      </form>
      <input className="search" placeholder="준비물 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      {filtered.map((item) => (
        <article className="card" key={item.id}>
          <strong>{item.name}</strong>
          <div>
            <span className="badge">{ITEM_TYPE_LABEL[item.item_type]}</span>
            <span className="badge">{item.default_unit}</span>
            {item.requires_return ? <span className="badge">회수</span> : <span className="badge">소모</span>}
            {item.is_active ? null : <span className="badge">비활성</span>}
          </div>
          {item.is_active ? (
            <div className="btn-row">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setEditing(item.id);
                  setForm({
                    name: item.name,
                    item_type: item.item_type,
                    default_unit: item.default_unit,
                    requires_return: item.requires_return,
                    memo: item.memo ?? "",
                  });
                }}
              >
                수정
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => void onDeactivate(item)}>
                비활성화
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
