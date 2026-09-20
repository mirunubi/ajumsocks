import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CONTRACT_LABEL } from "../lib/events";
import { callOrganizerAdmin } from "../lib/functions";
import { contrastText, type Organizer } from "../lib/organizers";
import { AdminChrome } from "./AdminChrome";

export function OrganizersScreen() {
  const [rows, setRows] = useState<Organizer[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void callOrganizerAdmin({ action: "list" })
      .then((result) => setRows((result.organizers ?? []) as Organizer[]))
      .catch((error: Error) => setMessage(error.message));
  }, []);

  return (
    <AdminChrome title="주최자 관리">
      <Link className="primary-link" to="/organizers/new">
        + 주최자 등록
      </Link>
      {message ? <div className="error">{message}</div> : null}
      {rows.length === 0 ? <div className="placeholder">등록된 주최자가 없습니다.</div> : null}
      {rows.map((row) => (
        <Link className="event-card-link" key={row.id} to={`/organizers/${row.id}`}>
          <article className="card event-card">
            <div className="stack-row">
              <span className="color-dot" style={{ background: row.calendar_color, color: contrastText(row.calendar_color) }} />
              <strong>{row.name}</strong>
              <span className="badge">{row.is_active ? "활성" : "비활성"}</span>
            </div>
            <div className="muted">담당자 {row.contact_count ?? 0}명</div>
            <div>
              {row.terms ? CONTRACT_LABEL[row.terms.default_contract_type] : "계약 없음"}
              {row.terms?.default_commission_rate != null ? ` · ${row.terms.default_commission_rate}%` : ""}
              {row.terms?.default_fixed_fee != null ? ` · ${Number(row.terms.default_fixed_fee).toLocaleString("ko-KR")}원` : ""}
            </div>
          </article>
        </Link>
      ))}
    </AdminChrome>
  );
}
