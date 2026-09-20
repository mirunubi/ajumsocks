import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { formatKstDateTime } from "../lib/datetime";
import { callEventInventory } from "../lib/functions";
import {
  KIND_LABEL,
  REMAINDER_OPTIONS,
  SCOPE_LABEL,
  deltaLabel,
  estimatedQty,
  filterInventoryLines,
  nextOpenInventoryItem,
  stockLabel,
  type CheckScope,
  type InventoryCheck,
  type InventoryLine,
  type RemainderLevel,
} from "../lib/inventory";

export function EventInventoryCheckScreen() {
  const { eventId = "", checkId = "" } = useParams();
  const navigate = useNavigate();
  const [check, setCheck] = useState<InventoryCheck | null>(null);
  const [items, setItems] = useState<InventoryLine[]>([]);
  const [unchecked, setUnchecked] = useState(0);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await callEventInventory({ action: "get-check", id: checkId });
    const nextItems = (result.items ?? []) as InventoryLine[];
    setCheck(result.check as InventoryCheck);
    setItems(nextItems);
    setUnchecked(Number(result.unchecked ?? 0));
    return nextItems;
  }, [checkId]);

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [refresh]);

  const lineFilter = useMemo(
    () => ({ onlyOpen, query, category, size, color }),
    [onlyOpen, query, category, size, color],
  );

  const filtered = useMemo(() => filterInventoryLines(items, lineFilter), [items, lineFilter]);

  const current = (currentId && filtered.find((item) => item.id === currentId)) || filtered[0] || null;
  const categories = [...new Set(items.map((item) => item.category_name || "미분류"))];
  const sizes = [...new Set(items.map((item) => item.size_name).filter(Boolean))] as string[];
  const colors = [...new Set(items.map((item) => item.color_name).filter(Boolean))] as string[];
  const grouped = useMemo(() => {
    const map = new Map<string, InventoryLine[]>();
    for (const item of filtered) {
      const key = item.category_name || "미분류";
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const draft = check?.status === "DRAFT";

  async function save(line: InventoryLine, full: number, remainder: RemainderLevel) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await callEventInventory({
        action: "save-item",
        id: line.id,
        full_pack_count: full,
        remainder_level: remainder,
        updated_at: line.updated_at,
      });
      const nextItems = await refresh();
      const next = nextOpenInventoryItem(nextItems, line.id, lineFilter);
      setCurrentId(next?.id ?? null);
      window.requestAnimationFrame(() => {
        document.getElementById("check-editor")?.scrollIntoView({ block: "nearest" });
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    setBusy(true);
    setMessage(null);
    try {
      await callEventInventory({ action: "confirm-check", id: checkId });
      navigate(`/events/${eventId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "확정 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    setBusy(true);
    try {
      await callEventInventory({ action: "cancel-check", id: checkId });
      navigate(`/events/${eventId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "취소 실패");
    } finally {
      setBusy(false);
    }
  }

  if (!check) {
    return (
      <div className="app-shell">
        <p className="muted">{message ?? "불러오는 중..."}</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to={`/events/${eventId}`}>← 행사</Link>
        <div className="brand">현장 실사</div>
      </div>
      <h1>
        {KIND_LABEL[check.check_kind]} · {SCOPE_LABEL[check.check_scope as CheckScope]}
      </h1>
      <p className="muted">
        미입력 {unchecked}개 / 전체 {items.length}개
        {check.check_scope === "FULL" ? " · 전체 입력 후 확정" : " · 입력한 SKU만 반영"}
      </p>
      <p className="muted">마지막 저장 {formatKstDateTime(check.updated_at || check.started_at)}</p>
      {message ? <div className="error">{message}</div> : null}

      <input className="search" placeholder="상품명, 코드, SKU" value={query} onChange={(e) => setQuery(e.target.value)} />
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
          <option value="">Size</option>
          {sizes.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select value={color} onChange={(e) => setColor(e.target.value)}>
          <option value="">Color</option>
          {colors.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
        미입력만
      </label>

      {current && draft ? (
        <div id="check-editor">
          <Editor line={current} busy={busy} onSave={save} />
        </div>
      ) : null}

      {grouped.map(([group, rows]) => {
        const open = openGroups[group] ?? true;
        return (
          <div key={group}>
            <button className="chip" type="button" onClick={() => setOpenGroups((prev) => ({ ...prev, [group]: !open }))}>
              {open ? "▾" : "▸"} {group} ({rows.length})
            </button>
            {open
              ? rows.map((row) => (
                <button
                  key={row.id}
                  className="stack-row"
                  type="button"
                  onClick={() => {
                    setOnlyOpen(false);
                    setCurrentId(row.id);
                  }}
                >
                  <div>
                    <strong>{row.product_name}</strong>
                    <div className="muted">
                      {row.sku_code} · {stockLabel(row.full_pack_count, row.remainder_level, Number(row.pack_size_snapshot))}
                      {current?.id === row.id ? " · 입력 중" : ""}
                    </div>
                  </div>
                </button>
              ))
              : null}
          </div>
        );
      })}

      {draft ? (
        <div className="btn-row">
          <button className="secondary" type="button" disabled={busy} onClick={() => void onCancel()}>
            실사 취소
          </button>
          <button type="button" disabled={busy} onClick={() => void onConfirm()}>
            실사 확정
          </button>
        </div>
      ) : (
        <p className="muted">확정된 실사는 수정하지 않습니다. 필요하면 새 중간 실사를 시작하세요.</p>
      )}
    </div>
  );
}

function Editor({
  line,
  busy,
  onSave,
}: {
  line: InventoryLine;
  busy: boolean;
  onSave: (line: InventoryLine, full: number, remainder: RemainderLevel) => Promise<void>;
}) {
  const [full, setFull] = useState(line.full_pack_count ?? 0);
  const [remainder, setRemainder] = useState<RemainderLevel | null>(line.remainder_level);

  useEffect(() => {
    setFull(line.full_pack_count ?? 0);
    setRemainder(line.remainder_level);
  }, [line.id, line.full_pack_count, line.remainder_level]);

  const pack = Number(line.pack_size_snapshot);
  const currentEst = estimatedQty(pack, remainder == null ? null : full, remainder);
  const delta = currentEst != null && line.previous_estimated_qty != null ? currentEst - line.previous_estimated_qty : null;

  return (
    <section className="card">
      {line.image_url ? <img className="hero-image" src={line.image_url} alt="" /> : null}
      <h2 className="section-title tight">{line.product_name}</h2>
      <p className="muted">
        {line.sku_code} · {line.size_name ?? "-"} / {line.color_name ?? "-"}
      </p>
      <p>이전: {line.previous_estimated_qty == null ? "없음" : `약 ${line.previous_estimated_qty}개`}</p>
      <p>현재입력: {stockLabel(remainder == null ? null : full, remainder, pack)}</p>
      {delta != null ? <p className="muted">차이 {deltaLabel(delta)} (판매량이 아닙니다)</p> : null}

      <div className="muted">완전 묶음</div>
      <div className="stepper">
        <button className="stepper-btn" type="button" disabled={busy || full <= 0} onClick={() => setFull((n) => Math.max(0, n - 1))}>
          −
        </button>
        <strong className="stepper-value">{full}</strong>
        <button className="stepper-btn" type="button" disabled={busy} onClick={() => setFull((n) => n + 1)}>
          +
        </button>
      </div>
      <div className="muted">개봉 묶음</div>
      <div className="remainder-row">
        {REMAINDER_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={remainder === option.id ? "remainder-btn active" : "remainder-btn"}
            disabled={busy}
            onClick={() => setRemainder(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <button type="button" disabled={busy || remainder == null} onClick={() => void onSave(line, full, remainder as RemainderLevel)}>
        저장 후 다음
      </button>
    </section>
  );
}
