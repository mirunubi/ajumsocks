import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { callInventoryMovement } from "../lib/functions";
import { LOCATION_TYPE_LABEL, approxLabel, type InventoryLocation } from "../lib/movement";

type Line = {
  product_variant_id: string;
  product_name: string;
  sku_code: string;
  category_name: string;
  position_units: number;
  reserved_units: number;
  available_units: number;
};

export function ClosingDistributeScreen() {
  const { eventId = "", checkId = "" } = useParams();
  const navigate = useNavigate();
  const [lines, setLines] = useState<Line[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [preview, loc] = await Promise.all([
      callInventoryMovement({ action: "closing-distribution-preview", check_id: checkId }),
      callInventoryMovement({ action: "list-locations" }),
    ]);
    setLines((preview.lines ?? []) as Line[]);
    setLocations(((loc.locations ?? []) as InventoryLocation[]).filter((row) => row.is_active !== false && row.event_id !== eventId));
  }, [checkId, eventId]);

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [refresh]);

  const groups = useMemo(() => {
    const map = new Map<string, Line[]>();
    for (const line of lines) {
      const key = line.category_name || "미분류";
      const list = map.get(key) ?? [];
      list.push(line);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [lines]);

  async function onCreate() {
    setBusy(true);
    setMessage(null);
    try {
      await callInventoryMovement({
        action: "create-closing-distribution",
        check_id: checkId,
        destinations,
      });
      navigate("/movements");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "분배 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to={`/events/${eventId}`}>← 행사</Link>
        <div className="brand">남은 재고 보내기</div>
      </div>
      <h1>남은 재고 보내기</h1>
      <p className="muted">분류별로 목적지를 고르면 출발-도착 쌍마다 이동이 만들어집니다.</p>
      {message ? <div className="error">{message}</div> : null}
      {groups.map(([group, rows]) => (
        <section className="card" key={group}>
          <h2 className="section-title tight">{group}</h2>
          <select value={destinations[group] ?? ""} onChange={(e) => setDestinations((prev) => ({ ...prev, [group]: e.target.value }))}>
            <option value="">목적지 선택</option>
            {locations.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} ({LOCATION_TYPE_LABEL[row.location_type]})
              </option>
            ))}
          </select>
          {rows.map((row) => (
            <div className="stack-row" key={row.product_variant_id}>
              <div>
                <strong>{row.product_name}</strong>
                <div className="muted">{row.sku_code}</div>
                <div>
                  현재 {approxLabel(row.position_units)} · 이동예정 {approxLabel(row.reserved_units)} · 추가 가능 {approxLabel(row.available_units)}
                </div>
              </div>
            </div>
          ))}
        </section>
      ))}
      <button type="button" disabled={busy} onClick={() => void onCreate()}>
        이동 작성
      </button>
    </div>
  );
}
