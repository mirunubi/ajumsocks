import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { callInventoryMovement } from "../lib/functions";
import { LOCATION_TYPE_LABEL, type InventoryLocation, type LocationType } from "../lib/movement";

export function LocationsScreen() {
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<LocationType>("TEMP");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const result = await callInventoryMovement({ action: "list-locations" });
    setLocations((result.locations ?? []) as InventoryLocation[]);
  }

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await callInventoryMovement({ action: "create-location", location_type: type, name });
      setName("");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to="/">← 홈</Link>
        <div className="brand">재고 위치</div>
      </div>
      <h1>재고 위치</h1>
      {message ? <div className="error">{message}</div> : null}
      <form onSubmit={(e) => void onCreate(e)}>
        <label>이름</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        <label>종류</label>
        <select value={type} onChange={(e) => setType(e.target.value as LocationType)}>
          <option value="HQ">본사</option>
          <option value="TEMP">임시보관</option>
          <option value="THIRD_PARTY">제3장소</option>
        </select>
        <button type="submit" disabled={busy}>
          위치 만들기
        </button>
      </form>
      {locations.map((row) => (
        <Link className="event-card-link" key={row.id} to={`/locations/${row.id}`}>
          <article className="card event-card">
            <strong>{row.name}</strong>
            <span className="badge">{LOCATION_TYPE_LABEL[row.location_type]}</span>
          </article>
        </Link>
      ))}
    </div>
  );
}
