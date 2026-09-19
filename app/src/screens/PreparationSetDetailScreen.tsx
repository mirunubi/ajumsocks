import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { callPrepAdmin } from "../lib/functions";
import {
  ITEM_TYPE_LABEL,
  formatQty,
  type PreparationItem,
  type PreparationSet,
  type PreparationSetItem,
} from "../lib/preparation";

export function PreparationSetDetailScreen() {
  const { id = "" } = useParams();
  const [setRow, setSetRow] = useState<PreparationSet | null>(null);
  const [lines, setLines] = useState<PreparationSetItem[]>([]);
  const [items, setItems] = useState<PreparationItem[]>([]);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const [sets, masters] = await Promise.all([
      callPrepAdmin({ action: "list-sets" }),
      callPrepAdmin({ action: "list-items" }),
    ]);
    const found = ((sets.sets ?? []) as PreparationSet[]).find((row) => row.id === id) ?? null;
    setSetRow(found);
    setLines(((sets.set_items ?? []) as PreparationSetItem[]).filter((row) => row.preparation_set_id === id));
    setItems((masters.items ?? []) as PreparationItem[]);
  }

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [id]);

  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const used = new Set(lines.map((line) => line.preparation_item_id));

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await callPrepAdmin({
        action: "add-set-item",
        preparation_set_id: id,
        preparation_item_id: itemId,
        planned_quantity: Number(qty),
      });
      setItemId("");
      setQty("1");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "추가 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onQty(lineId: string, value: string) {
    const planned_quantity = Number(value);
    if (planned_quantity < 1) return;
    setBusy(true);
    try {
      await callPrepAdmin({ action: "update-set-item", id: lineId, planned_quantity });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "수량 변경 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(lineId: string) {
    setBusy(true);
    try {
      await callPrepAdmin({ action: "remove-set-item", id: lineId });
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
        <Link to="/preparation-sets">← 세트</Link>
        <p className="muted">세트를 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to="/preparation-sets">← 세트</Link>
        <div className="brand">세트 구성</div>
      </div>
      <h1>{setRow.name}</h1>
      {setRow.description ? <p className="muted">{setRow.description}</p> : null}
      {message ? <div className="error">{message}</div> : null}
      {lines.map((line) => {
        const item = itemMap.get(line.preparation_item_id);
        return (
          <article className="card" key={line.id}>
            <strong>{item?.name ?? "알 수 없는 항목"}</strong>
            <div>
              {item ? <span className="badge">{ITEM_TYPE_LABEL[item.item_type]}</span> : null}
              <span className="badge">{formatQty(line.planned_quantity, item?.default_unit || "개")}</span>
            </div>
            <div className="qty-row">
              <input type="number" min={1} defaultValue={Number(line.planned_quantity)} onBlur={(e) => void onQty(line.id, e.target.value)} />
              <button type="button" className="tiny danger" disabled={busy} onClick={() => void onRemove(line.id)}>
                삭제
              </button>
            </div>
          </article>
        );
      })}
      <form className="card" onSubmit={(event) => void onAdd(event)}>
        <label>항목 추가</label>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} required>
          <option value="">준비물 선택</option>
          {items
            .filter((item) => item.is_active && !used.has(item.id))
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
        <label>수량</label>
        <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} required />
        <button type="submit" disabled={busy}>
          세트에 추가
        </button>
      </form>
    </div>
  );
}
