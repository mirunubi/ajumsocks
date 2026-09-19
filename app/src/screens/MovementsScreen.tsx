import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callInventoryMovement } from "../lib/functions";
import { MOVEMENT_STATUS_LABEL, type MovementRecord } from "../lib/movement";
import { useAuth } from "../lib/session";

export function MovementsScreen() {
  const { profile } = useAuth();
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void callInventoryMovement({ action: "list-movements" })
      .then((result) => setMovements((result.movements ?? []) as MovementRecord[]))
      .catch((error: Error) => setMessage(error.message));
  }, []);

  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to="/">← 홈</Link>
        <div className="brand">재고 보내기</div>
      </div>
      <h1>재고 보내기</h1>
      {profile?.role === "ADMIN" ? (
        <Link className="primary-link" to="/movements/new">
          새 이동 작성
        </Link>
      ) : null}
      {message ? <div className="error">{message}</div> : null}
      {movements.map((row) => (
        <Link className="event-card-link" key={row.id} to={`/movements/${row.id}`}>
          <article className="card event-card">
            <strong>{row.movement_no}</strong>
            <div>
              {row.source?.name} → {row.destination?.name}
            </div>
            <span className="badge">{MOVEMENT_STATUS_LABEL[row.status]}</span>
          </article>
        </Link>
      ))}
    </div>
  );
}
