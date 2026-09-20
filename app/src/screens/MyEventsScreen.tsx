import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { denialMessage } from "../lib/access";
import { formatKstRange, kstHm, kstYmd, scheduleHint } from "../lib/datetime";
import { EVENT_STATUS_LABEL, type EventRecord } from "../lib/events";
import { daysUntil, prepProgress, type EventPrepItem } from "../lib/preparation";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/session";
import type { Organizer } from "../lib/organizers";

type Extra = {
  organizerName: string;
  prepLabel?: string;
  lastCheck?: string;
  salesToday?: string;
};

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

function EventCard({ event, extra }: { event: EventRecord; extra: Extra }) {
  return (
    <Link className="event-card-link" to={`/events/${event.id}`}>
      <article className="card event-card">
        <strong>{event.name}</strong>
        <div className="muted">{event.venue_name}</div>
        <div className="muted">{extra.organizerName}</div>
        <div>
          {formatKstRange(event.starts_at, event.ends_at)} · {kstHm(event.starts_at)}~{kstHm(event.ends_at)}
        </div>
        <div>
          <span className="badge">{EVENT_STATUS_LABEL[event.status]}</span>
          <span className="badge">{scheduleHint(event.starts_at, event.ends_at)}</span>
        </div>
        {extra.prepLabel ? <div className="muted">{extra.prepLabel}</div> : null}
        {extra.lastCheck ? <div className="muted">최근 재고확인 {extra.lastCheck}</div> : null}
        {extra.salesToday ? <div className="muted">{extra.salesToday}</div> : null}
      </article>
    </Link>
  );
}

export function MyEventsScreen() {
  const { loading, session, profile, denial } = useAuth();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [organizers, setOrganizers] = useState<Record<string, Organizer>>({});
  const [prepByEvent, setPrepByEvent] = useState<Record<string, EventPrepItem[]>>({});
  const [lastCheck, setLastCheck] = useState<Record<string, string>>({});
  const [salesToday, setSalesToday] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!session || denial || !profile) return;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
    void Promise.all([
      supabase
        .from("events")
        .select("id, name, venue_name, starts_at, ends_at, status, address, organizer_id")
        .order("starts_at", { ascending: true }),
      supabase.from("event_organizers").select("id, name, calendar_color, is_active"),
      supabase.from("event_preparation_items").select("*").is("removed_at", null),
      supabase.from("event_inventory_checks").select("event_id, confirmed_at, status").eq("status", "CONFIRMED").order("confirmed_at", { ascending: false }),
      supabase.from("event_daily_sales").select("event_id, business_date").eq("business_date", today),
    ]).then(([eventResult, orgResult, prepResult, checkResult, salesResult]) => {
      if (eventResult.error) setMessage(eventResult.error.message);
      else setEvents((eventResult.data ?? []) as EventRecord[]);
      const orgMap: Record<string, Organizer> = {};
      for (const row of (orgResult.data ?? []) as Organizer[]) orgMap[row.id] = row;
      setOrganizers(orgMap);
      if (!prepResult.error) {
        const grouped: Record<string, EventPrepItem[]> = {};
        for (const row of (prepResult.data ?? []) as EventPrepItem[]) {
          grouped[row.event_id] = grouped[row.event_id] || [];
          grouped[row.event_id].push(row);
        }
        setPrepByEvent(grouped);
      }
      const checks: Record<string, string> = {};
      for (const row of (checkResult.data ?? []) as Array<{ event_id: string; confirmed_at: string }>) {
        if (!checks[row.event_id] && row.confirmed_at) checks[row.event_id] = kstYmd(row.confirmed_at);
      }
      setLastCheck(checks);
      const sales: Record<string, boolean> = {};
      for (const row of (salesResult.data ?? []) as Array<{ event_id: string }>) sales[row.event_id] = true;
      setSalesToday(sales);
    });
  }, [session, denial, profile]);

  if (loading) {
    return (
      <div className="app-shell center">
        <p className="muted">확인 중...</p>
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  if (denial) {
    return (
      <div className="app-shell">
        <div className="brand">아점삭스</div>
        <h1>접근할 수 없습니다</h1>
        <p className="muted">{denialMessage(denial)}</p>
        <button className="secondary" type="button" onClick={() => void supabase.auth.signOut()}>
          로그아웃
        </button>
      </div>
    );
  }
  if (!profile) return <Navigate to="/login" replace />;
  if (profile.role === "ADMIN") return <Navigate to="/admin" replace />;

  const { today, upcoming } = splitEvents(events);
  function extraFor(event: EventRecord, includeTodaySales: boolean): Extra {
    const rows = prepByEvent[event.id];
    const progress = rows?.length ? prepProgress(rows) : null;
    const dday = daysUntil(event.starts_at);
    const due = progress && dday >= 0 && dday <= 2 ? ` · D-${dday}` : "";
    return {
      organizerName: (event.organizer_id && organizers[event.organizer_id]?.name) || "주최자 미지정",
      prepLabel: progress ? `준비완료 ${progress.ready} / ${progress.total}${due}` : undefined,
      lastCheck: lastCheck[event.id],
      salesToday: includeTodaySales ? (salesToday[event.id] ? "오늘 매출 입력됨" : "오늘 매출 미입력") : undefined,
    };
  }

  return (
    <div className="app-shell">
      <div className="brand">아점삭스</div>
      <h1>{profile.role === "PART_TIMER" ? "오늘 행사" : "내 행사"}</h1>
      <div>
        <span className="badge">{profile.display_name}</span>
        <span className="badge">{profile.role}</span>
      </div>
      {message ? <div className="error">{message}</div> : null}

      <h2 className="section-title">오늘 내 행사</h2>
      {today.length === 0 ? (
        <div className="placeholder">오늘 배정된 행사가 없습니다.</div>
      ) : (
        today.map((event) => <EventCard key={event.id} event={event} extra={extraFor(event, true)} />)
      )}

      <h2 className="section-title">다가오는 내 행사</h2>
      {upcoming.length === 0 ? (
        <div className="placeholder">예정된 행사가 없습니다.</div>
      ) : (
        upcoming.map((event) => <EventCard key={event.id} event={event} extra={extraFor(event, false)} />)
      )}

      <Link className="primary-link" to="/movements">
        재고 보내기
      </Link>
      <button className="secondary" type="button" onClick={() => void supabase.auth.signOut()}>
        로그아웃
      </button>
    </div>
  );
}
