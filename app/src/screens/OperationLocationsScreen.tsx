import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { callEventOps } from "../lib/functions";
import { OPERATION_LOCATION_LABEL, type OperationLocationType } from "../lib/operations";
import { AdminChrome } from "./AdminChrome";

type Location = {
  id: string;
  name: string;
  location_type: OperationLocationType;
  address: string | null;
  is_active: boolean;
  memo: string | null;
};

export function OperationLocationsScreen() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<OperationLocationType>("OFFICE");
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState<Location | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const result = await callEventOps({ action: "list-locations" });
    setLocations((result.locations ?? []) as Location[]);
  }

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await callEventOps({ action: "create-location", name, location_type: type, address });
      setName("");
      setAddress("");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(row: Location) {
    setBusy(true);
    try {
      await callEventOps({ action: "update-location", id: row.id, is_active: !row.is_active });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "변경 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      await callEventOps({
        action: "update-location",
        id: editing.id,
        name: editing.name,
        location_type: editing.location_type,
        address: editing.address,
        memo: editing.memo,
      });
      setEditing(null);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "수정 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminChrome title="운영 거점">
      <Link to="/admin">← 일정</Link>
      <p className="muted">사람/짐 이동 거점입니다. 재고 위치와 행사장은 여기에 넣지 않습니다.</p>
      {message ? <div className="error">{message}</div> : null}
      <form className="card" onSubmit={(event) => void onCreate(event)}>
        <label>이름</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        <label>종류</label>
        <select value={type} onChange={(e) => setType(e.target.value as OperationLocationType)}>
          {(Object.keys(OPERATION_LOCATION_LABEL) as OperationLocationType[]).map((key) => (
            <option key={key} value={key}>
              {OPERATION_LOCATION_LABEL[key]}
            </option>
          ))}
        </select>
        <label>주소</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
        <button type="submit" disabled={busy}>
          거점 만들기
        </button>
      </form>
      {locations.map((row) => (
        <article className="card event-card" key={row.id}>
          <strong>{row.name}</strong>
          <div>
            <span className="badge">{OPERATION_LOCATION_LABEL[row.location_type]}</span>
            <span className="badge">{row.is_active ? "사용" : "비활성"}</span>
          </div>
          {row.address ? <div className="muted">{row.address}</div> : null}
          {editing?.id === row.id ? (
            <form onSubmit={(event) => void onSaveEdit(event)}>
              <label>이름</label>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
              <label>주소</label>
              <input value={editing.address ?? ""} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
              <div className="btn-row">
                <button type="submit" disabled={busy}>
                  저장
                </button>
                <button className="secondary" type="button" onClick={() => setEditing(null)}>
                  취소
                </button>
              </div>
            </form>
          ) : (
            <div className="btn-row">
              <button className="secondary tiny-btn" type="button" disabled={busy} onClick={() => setEditing(row)}>
                수정
              </button>
              <button className="secondary tiny-btn" type="button" disabled={busy} onClick={() => void onToggle(row)}>
                {row.is_active ? "비활성화" : "다시 사용"}
              </button>
            </div>
          )}
        </article>
      ))}
    </AdminChrome>
  );
}
