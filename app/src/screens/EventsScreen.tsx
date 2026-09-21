import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { formatKstRange, scheduleHint } from "../lib/datetime";
import { EVENT_STATUS_LABEL, memberCount, type EventRecord, type EventStatus } from "../lib/events";
import { SCHEDULE_STATUS_LABEL } from "../lib/operations";
import { supabase } from "../lib/supabase";

const STATUS_FILTERS: Array<{ id: "ALL" | EventStatus; label: string }> = [
  { id: "ALL", label: "전체" },
  { id: "PREPARING", label: "준비중" },
  { id: "ACTIVE", label: "진행중" },
  { id: "ENDED", label: "종료" },
  { id: "SETTLED", label: "정산완료" },
  { id: "CANCELLED", label: "취소" },
];

function sortEvents(events: EventRecord[]) {
  const now = Date.now();
  return [...events].sort((a, b) => {
    const aPast = Date.parse(a.ends_at) < now ? 1 : 0;
    const bPast = Date.parse(b.ends_at) < now ? 1 : 0;
    if (aPast !== bPast) return aPast - bPast;
    return Date.parse(b.starts_at) - Date.parse(a.starts_at);
  });
}

export function EventsScreen() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | EventStatus>("ALL");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from("events")
      .select(
        "id, name, starts_at, ends_at, status, schedule_status, venue_name, address, address_detail, memo, contract_type, contract_memo, organizer_id, created_by, created_at, updated_at, event_members(count)",
      )
      .then(({ data, error }) => {
        if (error) setMessage(error.message);
        else setEvents((data ?? []) as EventRecord[]);
      });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim();
    return sortEvents(events).filter((event) => {
      if (status !== "ALL" && event.status !== status) return false;
      if (!q) return true;
      return event.name.includes(q) || event.venue_name.includes(q);
    });
  }, [events, query, status]);

  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to="/admin">← 일정</Link>
        <div className="brand">행사관리</div>
      </div>
      <h1>행사관리</h1>
      <Link className="primary-link" to="/events/new">
        새 행사 만들기
      </Link>
      {message ? <div className="error">{message}</div> : null}
      <input className="search" placeholder="행사명 또는 행사장명" value={query} onChange={(e) => setQuery(e.target.value)} />
      <form className="chip-row" onSubmit={(event: FormEvent) => event.preventDefault()}>
        {STATUS_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={status === item.id ? "chip active" : "chip"}
            onClick={() => setStatus(item.id)}
          >
            {item.label}
          </button>
        ))}
      </form>
      {filtered.length === 0 ? <div className="placeholder">조건에 맞는 행사가 없습니다.</div> : null}
      {filtered.map((event) => (
        <Link className="event-card-link" to={`/events/${event.id}`} key={event.id}>
          <article className="card event-card">
            <strong>{event.name}</strong>
            <div>{event.venue_name}</div>
            <div>{formatKstRange(event.starts_at, event.ends_at)}</div>
            <div>
              <span className="badge">{EVENT_STATUS_LABEL[event.status]}</span>
              {event.schedule_status === "TENTATIVE" ? <span className="badge">{SCHEDULE_STATUS_LABEL.TENTATIVE}</span> : null}
              <span className="badge">{scheduleHint(event.starts_at, event.ends_at)}</span>
              <span className="badge">배정 {memberCount(event)}명</span>
            </div>
          </article>
        </Link>
      ))}
    </div>
  );
}
