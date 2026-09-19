import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { callInventoryMovement } from "../lib/functions";
import { LOCATION_TYPE_LABEL, type InventoryLocation } from "../lib/movement";

export function MovementNewScreen() {
  const navigate = useNavigate();
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void callInventoryMovement({ action: "list-locations" })
      .then((result) => {
        const rows = ((result.locations ?? []) as InventoryLocation[]).filter((row) => row.is_active !== false);
        setLocations(rows);
        setSource(rows[0]?.id ?? "");
        setDestination(rows[1]?.id ?? "");
      })
      .catch((error: Error) => setMessage(error.message));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const created = await callInventoryMovement({
        action: "create-movement",
        source_location_id: source,
        destination_location_id: destination,
      });
      navigate(`/movements/${created.movement.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "작성 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to="/movements">← 재고 보내기</Link>
        <div className="brand">새 이동</div>
      </div>
      <h1>재고 보내기</h1>
      {message ? <div className="error">{message}</div> : null}
      <form onSubmit={(e) => void onSubmit(e)}>
        <label>출발</label>
        <select value={source} onChange={(e) => setSource(e.target.value)} required>
          {locations.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name} ({LOCATION_TYPE_LABEL[row.location_type]})
            </option>
          ))}
        </select>
        <label>도착</label>
        <select value={destination} onChange={(e) => setDestination(e.target.value)} required>
          {locations.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name} ({LOCATION_TYPE_LABEL[row.location_type]})
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !source || !destination}>
          작성
        </button>
      </form>
    </div>
  );
}
