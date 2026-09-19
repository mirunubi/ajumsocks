import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { callEventInventory } from "../lib/functions";
import { formatKstDateTime } from "../lib/datetime";
import {
  KIND_LABEL,
  SCOPE_LABEL,
  STATUS_LABEL,
  stockLabel,
  type CheckKind,
  type CheckScope,
  type InventoryCheck,
  type InventoryLine,
} from "../lib/inventory";
import { MOVEMENT_STATUS_LABEL, approxLabel, type MovementRecord } from "../lib/movement";

export function EventInventoryPanel({ eventId }: { eventId: string }) {
  const navigate = useNavigate();
  const [current, setCurrent] = useState<InventoryLine[]>([]);
  const [checks, setChecks] = useState<InventoryCheck[]>([]);
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [kind, setKind] = useState<CheckKind>("ROUTINE");
  const [scope, setScope] = useState<CheckScope>("FULL");
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await callEventInventory({ action: "get-current", event_id: eventId });
    setCurrent((result.current ?? []) as InventoryLine[]);
    setChecks((result.checks ?? []) as InventoryCheck[]);
    setMovements((result.movements ?? []) as MovementRecord[]);
  }, [eventId]);

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return current.filter((row) => {
      if (!q) return true;
      return (
        row.product_name.toLowerCase().includes(q) ||
        row.product_code.toLowerCase().includes(q) ||
        row.sku_code.toLowerCase().includes(q)
      );
    });
  }, [current, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, InventoryLine[]>();
    for (const row of filtered) {
      const key = row.category_name || "미분류";
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const draft = checks.find((row) => row.status === "DRAFT");
  const closing = checks.find((row) => row.status === "CONFIRMED" && row.check_kind === "CLOSING");

  async function onCreate() {
    setBusy(true);
    setMessage(null);
    try {
      const created = await callEventInventory({
        action: "create-check",
        event_id: eventId,
        check_kind: kind,
        check_scope: scope,
      });
      navigate(`/events/${eventId}/inventory/${created.check.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "실사 시작 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="section-title tight">재고</h2>
      <p className="muted">현장 근사재고입니다. 정확한 개수가 아니며 판매량으로 보지 않습니다.</p>
      {closing ? (
        <Link className="primary-link" to={`/events/${eventId}/distribute/${closing.id}`}>
          남은 재고 보내기
        </Link>
      ) : null}
      {message ? <div className="error">{message}</div> : null}

      <div className="filters">
        <select value={kind} onChange={(e) => setKind(e.target.value as CheckKind)}>
          {(Object.keys(KIND_LABEL) as CheckKind[]).map((key) => (
            <option key={key} value={key}>
              {KIND_LABEL[key]}
            </option>
          ))}
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value as CheckScope)}>
          {(Object.keys(SCOPE_LABEL) as CheckScope[]).map((key) => (
            <option key={key} value={key}>
              {SCOPE_LABEL[key]}
            </option>
          ))}
        </select>
      </div>
      <button type="button" disabled={busy} onClick={() => void onCreate()}>
        실사 시작
      </button>
      {draft ? (
        <Link className="primary-link" to={`/events/${eventId}/inventory/${draft.id}`}>
          작성중 실사 이어하기 ({KIND_LABEL[draft.check_kind]})
        </Link>
      ) : null}

      <input className="search" placeholder="상품명, 코드, SKU" value={query} onChange={(e) => setQuery(e.target.value)} />
      {grouped.length === 0 ? <p className="muted">아직 확정된 현장재고가 없습니다.</p> : null}
      {grouped.map(([group, rows]) => {
        const open = openGroups[group] ?? true;
        return (
          <div key={group}>
            <button className="chip" type="button" onClick={() => setOpenGroups((prev) => ({ ...prev, [group]: !open }))}>
              {open ? "▾" : "▸"} {group} ({rows.length})
            </button>
            {open
              ? rows.map((row) => (
                <article className="stack-row" key={row.id}>
                  {row.image_url ? <img className="thumb" src={row.image_url} alt="" /> : null}
                  <div>
                    <strong>{row.product_name}</strong>
                    <div className="muted">
                      {row.sku_code} · {row.size_name ?? "-"} / {row.color_name ?? "-"}
                    </div>
                    <div>최근 실사 {stockLabel(row.full_pack_count, row.remainder_level, Number(row.pack_size_snapshot))}</div>
                    {row.operational_estimated_qty != null ? <div>현재 예상 {approxLabel(row.operational_estimated_qty)}</div> : null}
                    <div className="muted">최근 {formatKstDateTime(row.updated_at || row.updated_at_current || "")}</div>
                  </div>
                </article>
              ))
              : null}
          </div>
        );
      })}

      <h3 className="section-title">최근 이동</h3>
      {movements.length === 0 ? <p className="muted">이 행사와 연결된 이동이 없습니다.</p> : null}
      {movements.slice(0, 8).map((row) => (
        <Link className="stack-row" key={row.id} to={`/movements/${row.id}`}>
          <div>
            {row.movement_no}
            <div className="muted">{MOVEMENT_STATUS_LABEL[row.status]}</div>
          </div>
        </Link>
      ))}

      <h3 className="section-title">실사 이력</h3>
      {checks.map((check) => (
        <div className="stack-row" key={check.id}>
          <div>
            {KIND_LABEL[check.check_kind]} · {SCOPE_LABEL[check.check_scope]}
            <div className="muted">{formatKstDateTime(check.started_at)}</div>
          </div>
          <span className="badge">{STATUS_LABEL[check.status]}</span>
          {check.status === "DRAFT" ? (
            <Link className="tiny" to={`/events/${eventId}/inventory/${check.id}`}>
              계속
            </Link>
          ) : null}
        </div>
      ))}
    </section>
  );
}
