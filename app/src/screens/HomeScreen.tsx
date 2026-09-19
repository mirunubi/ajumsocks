import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { denialMessage } from "../lib/access";
import { formatKstRange, scheduleHint } from "../lib/datetime";
import { EVENT_STATUS_LABEL, type EventRecord } from "../lib/events";
import { daysUntil, prepProgress, type EventPrepItem } from "../lib/preparation";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/session";

function splitEvents(events: EventRecord[], now = new Date()) {
  const t = now.getTime();
  const today: EventRecord[] = [];
  const upcoming: EventRecord[] = [];
  const other: EventRecord[] = [];
  for (const event of events) {
    const start = Date.parse(event.starts_at);
    const end = Date.parse(event.ends_at);
    if (event.status === "CANCELLED") other.push(event);
    else if (t >= start && t <= end) today.push(event);
    else if (t < start) upcoming.push(event);
    else other.push(event);
  }
  return { today, upcoming, other };
}

function EventCard({ event, prepLabel }: { event: EventRecord; prepLabel?: string }) {
  return (
    <Link className="event-card-link" to={`/events/${event.id}`}>
      <article className="card event-card">
        <strong>{event.name}</strong>
        <div className="muted">{event.venue_name}</div>
        <div>{formatKstRange(event.starts_at, event.ends_at)}</div>
        <div>
          <span className="badge">{EVENT_STATUS_LABEL[event.status]}</span>
          <span className="badge">{scheduleHint(event.starts_at, event.ends_at)}</span>
        </div>
        {prepLabel ? <div className="muted">{prepLabel}</div> : null}
      </article>
    </Link>
  );
}

export function HomeScreen() {
  const { loading, session, profile, denial } = useAuth();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [prepByEvent, setPrepByEvent] = useState<Record<string, EventPrepItem[]>>({});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!session || denial || !profile) return;
    void Promise.all([
      supabase.from("events").select("id, name, venue_name, starts_at, ends_at, status, address").order("starts_at", { ascending: true }),
      supabase.from("event_preparation_items").select("*").is("removed_at", null),
    ]).then(([eventResult, prepResult]) => {
      if (eventResult.error) setMessage(eventResult.error.message);
      else setEvents((eventResult.data ?? []) as EventRecord[]);
      if (prepResult.error) setMessage(prepResult.error.message);
      else {
        const grouped: Record<string, EventPrepItem[]> = {};
        for (const row of (prepResult.data ?? []) as EventPrepItem[]) {
          grouped[row.event_id] = grouped[row.event_id] || [];
          grouped[row.event_id].push(row);
        }
        setPrepByEvent(grouped);
      }
    });
  }, [session, denial, profile]);

  if (loading) {
    return (
      <div className="app-shell center">
        <p className="muted">확인 중...</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (denial) {
    return (
      <div className="app-shell">
        <div className="brand">아점삭스</div>
        <h1>접근할 수 없습니다</h1>
        <p className="muted">{denialMessage(denial)}</p>
        <p className="muted">Auth 세션이 있어도 업무 데이터는 열리지 않습니다.</p>
        <button className="secondary" type="button" onClick={() => void supabase.auth.signOut()}>
          로그아웃
        </button>
      </div>
    );
  }

  if (!profile) {
    return <Navigate to="/login" replace />;
  }

  const { today, upcoming, other } = splitEvents(events);
  function labelFor(event: EventRecord) {
    const rows = prepByEvent[event.id];
    if (!rows?.length) return undefined;
    const progress = prepProgress(rows);
    const dday = daysUntil(event.starts_at);
    const due = dday >= 0 && dday <= 2 ? ` · D-${dday}` : "";
    return `준비완료 ${progress.ready} / ${progress.total}${due}`;
  }
  const incomplete = [...today, ...upcoming].filter((event) => {
    const rows = prepByEvent[event.id];
    if (!rows?.length) return false;
    const progress = prepProgress(rows);
    return progress.ready < progress.total;
  });

  return (
    <div className="app-shell">
      <div className="brand">아점삭스</div>
      <h1>{profile.display_name}</h1>
      <div>
        <span className="badge">{profile.role}</span>
        {profile.is_master ? <span className="badge">MASTER</span> : null}
      </div>

      {message ? <div className="error">{message}</div> : null}

      {incomplete.length > 0 ? (
        <>
          <h2 className="section-title">준비 미완료 행사</h2>
          {incomplete.map((event) => (
            <EventCard key={`prep-${event.id}`} event={event} prepLabel={labelFor(event)} />
          ))}
        </>
      ) : null}

      <h2 className="section-title">오늘의 행사</h2>
      {today.length === 0 ? <div className="placeholder">오늘 배정된 행사가 없습니다.</div> : today.map((event) => <EventCard key={event.id} event={event} prepLabel={labelFor(event)} />)}

      <h2 className="section-title">다가오는 행사</h2>
      {upcoming.length === 0 ? <div className="placeholder">예정된 행사가 없습니다.</div> : upcoming.map((event) => <EventCard key={event.id} event={event} prepLabel={labelFor(event)} />)}

      {other.length > 0 ? (
        <>
          <h2 className="section-title">지난 / 취소 행사</h2>
          {other.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </>
      ) : null}

      {profile.role === "ADMIN" ? (
        <>
          <Link className="primary-link" to="/events">
            행사관리
          </Link>
          <Link className="primary-link" to="/preparations">
            준비물 관리
          </Link>
          <Link className="primary-link" to="/users">
            사용자 관리
          </Link>
        </>
      ) : null}
      <button className="secondary" type="button" onClick={() => void supabase.auth.signOut()}>
        로그아웃
      </button>
    </div>
  );
}
