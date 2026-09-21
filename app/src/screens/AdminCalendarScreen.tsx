import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addMonths, eventOverlapsDay, monthLabel, monthRangeIso, weeksInMonth, ymdFromDate } from "../lib/calendar";
import { callEventAdmin, callOrganizerAdmin } from "../lib/functions";
import { EVENT_STATUS_LABEL } from "../lib/events";
import { SCHEDULE_STATUS_LABEL, scheduleSortRank } from "../lib/operations";
import { contrastText, type CalendarEvent, type Organizer } from "../lib/organizers";
import { AdminChrome } from "./AdminChrome";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function AdminCalendarScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [organizerId, setOrganizerId] = useState("ALL");
  const [scheduleFilter, setScheduleFilter] = useState<"ALL" | "CONFIRMED" | "TENTATIVE">("ALL");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [selectedDay, setSelectedDay] = useState(ymdFromDate(now));
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const range = monthRangeIso(year, month);
    void Promise.all([
      callEventAdmin({ action: "calendar", from: range.from, to: range.to, organizer_id: organizerId === "ALL" ? undefined : organizerId }),
      callOrganizerAdmin({ action: "list" }),
    ])
      .then(([cal, org]) => {
        setEvents((cal.events ?? []) as CalendarEvent[]);
        setOrganizers((org.organizers ?? []) as Organizer[]);
      })
      .catch((error: Error) => setMessage(error.message));
  }, [year, month, organizerId]);

  const visibleEvents = useMemo(() => {
    return events.filter((event) => {
      if (scheduleFilter === "ALL") return true;
      return (event.schedule_status ?? "CONFIRMED") === scheduleFilter;
    });
  }, [events, scheduleFilter]);

  const weeks = useMemo(() => weeksInMonth(year, month), [year, month]);
  const dayEvents = visibleEvents
    .filter((event) => eventOverlapsDay(event.starts_at, event.ends_at, selectedDay))
    .slice()
    .sort((a, b) => scheduleSortRank(a.status, a.schedule_status ?? "CONFIRMED") - scheduleSortRank(b.status, b.schedule_status ?? "CONFIRMED"));

  function shift(delta: number) {
    const next = addMonths(year, month, delta);
    setYear(next.year);
    setMonth(next.month);
  }

  function goToday() {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth() + 1);
    setSelectedDay(ymdFromDate(t));
  }

  return (
    <AdminChrome title="행사 일정">
      {message ? <div className="error">{message}</div> : null}
      <div className="cal-toolbar">
        <button type="button" className="chip" onClick={() => shift(-1)}>
          이전달
        </button>
        <button type="button" className="chip" onClick={goToday}>
          오늘
        </button>
        <button type="button" className="chip" onClick={() => shift(1)}>
          다음달
        </button>
        <strong>{monthLabel(year, month)}</strong>
        <select value={organizerId} onChange={(e) => setOrganizerId(e.target.value)}>
          <option value="ALL">주최자 전체</option>
          {organizers.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
              {org.is_active ? "" : " (비활성)"}
            </option>
          ))}
        </select>
        <button type="button" className={scheduleFilter === "ALL" ? "chip active" : "chip"} onClick={() => setScheduleFilter("ALL")}>
          전체
        </button>
        <button type="button" className={scheduleFilter === "CONFIRMED" ? "chip active" : "chip"} onClick={() => setScheduleFilter("CONFIRMED")}>
          확정
        </button>
        <button type="button" className={scheduleFilter === "TENTATIVE" ? "chip active" : "chip"} onClick={() => setScheduleFilter("TENTATIVE")}>
          예정
        </button>
        <Link className="primary-link" to="/events/new">
          + 행사등록
        </Link>
      </div>

      <div className="cal-weekdays">
        {WEEKDAYS.map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>
      <div className="cal-grid">
        {weeks.flat().map((date) => {
          const day = ymdFromDate(date);
          const inMonth = date.getMonth() === month - 1;
          const items = visibleEvents
            .filter((event) => eventOverlapsDay(event.starts_at, event.ends_at, day))
            .slice()
            .sort((a, b) => scheduleSortRank(a.status, a.schedule_status ?? "CONFIRMED") - scheduleSortRank(b.status, b.schedule_status ?? "CONFIRMED"));
          return (
            <button
              type="button"
              key={day}
              className={`cal-cell ${inMonth ? "" : "muted-cell"} ${selectedDay === day ? "selected" : ""}`}
              onClick={() => setSelectedDay(day)}
            >
              <span className="cal-daynum">{date.getDate()}</span>
              {items.map((event) => {
                const bg = event.organizer_color || "#6B7280";
                const tentative = event.schedule_status === "TENTATIVE" && event.status !== "CANCELLED";
                return (
                  <Link
                    key={event.id}
                    className={`cal-bar ${event.status === "CANCELLED" ? "cancelled" : ""} ${tentative ? "tentative" : ""}`}
                    style={tentative ? { borderLeftColor: bg } : { background: bg, color: contrastText(bg) }}
                    to={`/events/${event.id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {tentative ? <span className="cal-dot" style={{ background: bg }} /> : null}
                    <span className="cal-status">
                      {tentative ? SCHEDULE_STATUS_LABEL.TENTATIVE : EVENT_STATUS_LABEL[event.status as keyof typeof EVENT_STATUS_LABEL]}
                    </span>
                    {event.venue_name} {event.name}
                  </Link>
                );
              })}
            </button>
          );
        })}
      </div>

      <section className="mobile-day-list">
        <h2 className="section-title">{selectedDay} 행사</h2>
        {dayEvents.length === 0 ? <div className="placeholder">이 날짜에 행사가 없습니다.</div> : null}
        {dayEvents.map((event) => {
          const bg = event.organizer_color || "#6B7280";
          const tentative = event.schedule_status === "TENTATIVE" && event.status !== "CANCELLED";
          return (
            <Link className="event-card-link" key={event.id} to={`/events/${event.id}`}>
              <article
                className={`card event-card ${event.status === "CANCELLED" ? "cancelled" : ""} ${tentative ? "tentative-card" : ""}`}
                style={{ borderLeft: `6px solid ${tentative ? "#9CA3AF" : bg}` }}
              >
                {tentative ? <span className="cal-dot" style={{ background: bg }} /> : null}
                <strong>{event.name}</strong>
                <div>{event.venue_name}</div>
                <div className="muted">{event.organizer_name || "주최자 미지정"}</div>
                <span className="badge">{EVENT_STATUS_LABEL[event.status as keyof typeof EVENT_STATUS_LABEL]}</span>
                <span className="badge">{tentative ? SCHEDULE_STATUS_LABEL.TENTATIVE : SCHEDULE_STATUS_LABEL.CONFIRMED}</span>
              </article>
            </Link>
          );
        })}
      </section>
    </AdminChrome>
  );
}
