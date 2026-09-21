import { useCallback, useEffect, useState, type FormEvent } from "react";
import { datetimeLocalKstToIso, formatKstDateTime, isoToDatetimeLocalKst } from "../lib/datetime";
import { callEventAdmin, callEventOps, callUserAdmin } from "../lib/functions";
import {
  FIXTURE_TYPE_LABEL,
  OPERATION_LOCATION_LABEL,
  SCHEDULE_STATUS_LABEL,
  SETUP_ROLE_LABEL,
  SETUP_STATUS_LABEL,
  TRANSITION_SUBJECT_LABEL,
  dimsLabel,
  mmToMetersLabel,
  type OperationLocationType,
  type SetupFixtureType,
  type SetupMemberRole,
  type TransitionSubject,
} from "../lib/operations";
import { supabase } from "../lib/supabase";

type Fixture = {
  id: string;
  fixture_type: SetupFixtureType;
  name_snapshot: string;
  width_mm: number | null;
  depth_mm: number | null;
  height_mm: number | null;
  frontage_mm_per_unit: number | null;
  planned_quantity: number;
  actual_quantity: number | null;
  rack_levels: number | null;
  layout_note: string | null;
};

type Session = {
  id: string;
  status: string;
  planned_start_at: string | null;
  planned_end_at: string | null;
  planned_staff_count: number | null;
  arrival_recorded_at: string | null;
  completed_recorded_at: string | null;
  adjusted_arrival_at: string | null;
  adjusted_completed_at: string | null;
  adjustment_reason: string | null;
  actual_staff_count: number | null;
  setup_notes: string | null;
  actual_notes: string | null;
  effective_arrival_at?: string | null;
  effective_completed_at?: string | null;
  duration_minutes?: number | null;
};

type Summary = {
  planned_table_count: number;
  planned_table_frontage_m: number;
  planned_rack_count: number;
  planned_total_rack_levels: number;
  other_planned_count: number;
};

type Transition = {
  id: string;
  from_event_id: string | null;
  from_operation_location_id: string | null;
  to_event_id: string | null;
  to_operation_location_id: string | null;
  movement_subject: TransitionSubject;
  planned_departure_at: string | null;
  planned_arrival_at: string | null;
  actual_departure_at: string | null;
  actual_arrival_at: string | null;
  note: string | null;
};

type Location = {
  id: string;
  name: string;
  location_type: OperationLocationType;
  is_active: boolean;
};

type Member = { id: string; profile_id: string; role: SetupMemberRole; display_name: string };
type Photo = { id: string; photo_type: string; recorded_at: string; signed_url?: string | null };

export function EventSetupPanel({
  eventId,
  isAdmin,
  eventName,
}: {
  eventId: string;
  isAdmin: boolean;
  eventName: string;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; display_name: string }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState({ start: "", end: "", staff: "", notes: "", lead: "" });
  const [fixtureForm, setFixtureForm] = useState({
    fixture_type: "TABLE" as SetupFixtureType,
    name_snapshot: "테이블",
    width_mm: "1800",
    depth_mm: "750",
    height_mm: "",
    planned_quantity: "4",
    rack_levels: "",
    frontage_mm_per_unit: "",
  });
  const [actualStaff, setActualStaff] = useState("");
  const [adjust, setAdjust] = useState({ arrival: "", completed: "", reason: "" });
  const [events, setEvents] = useState<Array<{ id: string; name: string; venue_name: string }>>([]);
  const [leg, setLeg] = useState({
    to_kind: "location" as "location" | "event",
    to_location_id: "",
    to_event_id: "",
    movement_subject: "GEAR" as TransitionSubject,
    depart: "",
    arrive: "",
  });

  const refresh = useCallback(async () => {
    const [setup, loc] = await Promise.all([
      callEventOps({ action: "get-setup", event_id: eventId }),
      isAdmin ? callEventOps({ action: "list-locations" }) : Promise.resolve({ locations: [] }),
    ]);
    setSession((setup.session ?? null) as Session | null);
    setFixtures((setup.fixtures ?? []) as Fixture[]);
    setSummary((setup.summary ?? null) as Summary | null);
    setMembers((setup.members ?? []) as Member[]);
    setPhotos((setup.photos ?? []) as Photo[]);
    setTransitions((setup.transitions ?? []) as Transition[]);
    setLocations(((loc.locations ?? []) as Location[]).filter((row) => row.is_active));
    const sess = setup.session as Session | null;
    if (sess) {
      setPlan({
        start: sess.planned_start_at ? isoToDatetimeLocalKst(sess.planned_start_at) : "",
        end: sess.planned_end_at ? isoToDatetimeLocalKst(sess.planned_end_at) : "",
        staff: sess.planned_staff_count == null ? "" : String(sess.planned_staff_count),
        notes: sess.setup_notes ?? "",
        lead: ((setup.members ?? []) as Member[]).find((row) => row.role === "LEAD")?.profile_id ?? "",
      });
      setActualStaff(sess.actual_staff_count == null ? "" : String(sess.actual_staff_count));
      setAdjust({
        arrival: sess.adjusted_arrival_at ? isoToDatetimeLocalKst(sess.adjusted_arrival_at) : "",
        completed: sess.adjusted_completed_at ? isoToDatetimeLocalKst(sess.adjusted_completed_at) : "",
        reason: sess.adjustment_reason ?? "",
      });
    }
  }, [eventId, isAdmin]);

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [refresh]);

  useEffect(() => {
    if (!isAdmin) return;
    void callUserAdmin({ action: "list" })
      .then((result) => {
        setUsers(((result.users ?? []) as Array<{ id: string; display_name: string; is_active?: boolean }>).filter((row) => row.is_active !== false));
      })
      .catch((error: Error) => setMessage(error.message));
    void callEventAdmin({
      action: "calendar",
      from: "2026-01-01T00:00:00+09:00",
      to: "2027-12-31T23:59:59+09:00",
    })
      .then((result) => {
        setEvents((result.events ?? []) as Array<{ id: string; name: string; venue_name: string }>);
      })
      .catch(() => undefined);
  }, [isAdmin]);

  async function onSavePlan(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const saved = await callEventOps({
        action: "save-plan",
        event_id: eventId,
        session_id: session?.id,
        planned_start_at: plan.start ? datetimeLocalKstToIso(plan.start) : null,
        planned_end_at: plan.end ? datetimeLocalKstToIso(plan.end) : null,
        planned_staff_count: plan.staff === "" ? null : Number(plan.staff),
        setup_notes: plan.notes,
      });
      const sessionId = saved.session.id as string;
      if (plan.lead) {
        await callEventOps({
          action: "set-members",
          setup_session_id: sessionId,
          members: [{ profile_id: plan.lead, role: "LEAD" }],
        });
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onAddFixture(event: FormEvent) {
    event.preventDefault();
    if (!session) {
      setMessage("먼저 세팅 계획을 저장하세요.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await callEventOps({
        action: "add-fixture",
        setup_session_id: session.id,
        fixture_type: fixtureForm.fixture_type,
        name_snapshot: fixtureForm.name_snapshot,
        width_mm: fixtureForm.width_mm === "" ? null : Number(fixtureForm.width_mm),
        depth_mm: fixtureForm.depth_mm === "" ? null : Number(fixtureForm.depth_mm),
        height_mm: fixtureForm.height_mm === "" ? null : Number(fixtureForm.height_mm),
        frontage_mm_per_unit: fixtureForm.frontage_mm_per_unit === "" ? null : Number(fixtureForm.frontage_mm_per_unit),
        planned_quantity: Number(fixtureForm.planned_quantity),
        rack_levels: fixtureForm.rack_levels === "" ? null : Number(fixtureForm.rack_levels),
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "집기 저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onActualQty(id: string, value: string) {
    try {
      await callEventOps({ action: "update-fixture", id, actual_quantity: value === "" ? null : Number(value) });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "수량 저장 실패");
    }
  }

  async function uploadPhoto(photo_type: "ARRIVAL" | "COMPLETION", files: FileList | null) {
    if (!files?.length || !session) return;
    setBusy(true);
    setMessage(null);
    try {
      for (const file of [...files]) {
        const signed = await callEventOps({
          action: "sign-upload",
          session_id: session.id,
          photo_type,
          original_filename: file.name,
          mime_type: file.type,
          file_size: file.size,
        });
        const { error } = await supabase.storage
          .from("setup-photos")
          .uploadToSignedUrl(signed.storage_path, signed.token, file, { contentType: file.type });
        if (error) throw error;
        await callEventOps({
          action: "complete-upload",
          session_id: session.id,
          storage_path: signed.storage_path,
          photo_type,
        });
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사진 업로드 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onActualStaff(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    try {
      await callEventOps({
        action: "save-actuals",
        session_id: session.id,
        actual_staff_count: actualStaff === "" ? null : Number(actualStaff),
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onAdjust(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    try {
      await callEventOps({
        action: "adjust-times",
        session_id: session.id,
        adjusted_arrival_at: adjust.arrival ? datetimeLocalKstToIso(adjust.arrival) : null,
        adjusted_completed_at: adjust.completed ? datetimeLocalKstToIso(adjust.completed) : null,
        adjustment_reason: adjust.reason,
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "보정 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onClosingGear(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await callEventOps({
        action: "save-transition",
        from_event_id: eventId,
        to_operation_location_id: leg.to_kind === "location" ? leg.to_location_id : undefined,
        to_event_id: leg.to_kind === "event" ? leg.to_event_id : undefined,
        movement_subject: leg.movement_subject,
        planned_departure_at: leg.depart ? datetimeLocalKstToIso(leg.depart) : null,
        planned_arrival_at: leg.arrive ? datetimeLocalKstToIso(leg.arrive) : null,
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이동 저장 실패");
    } finally {
      setBusy(false);
    }
  }

  const plannedRange =
    session?.planned_start_at && session.planned_end_at
      ? `${formatKstDateTime(session.planned_start_at)} ~ ${formatKstDateTime(session.planned_end_at)}`
      : "예정 시간 없음";

  return (
    <div>
      {message ? <div className="error">{message}</div> : null}
      <section className="card">
        <h2 className="section-title tight">오늘 세팅</h2>
        <p>
          {eventName} · {session ? SETUP_STATUS_LABEL[session.status as keyof typeof SETUP_STATUS_LABEL] : "계획 없음"}
        </p>
        <p>예정 {plannedRange}</p>
        <p>예정 인원 {session?.planned_staff_count ?? "—"}명</p>
        {summary ? (
          <p>
            설치 테이블 {summary.planned_table_count}개 / {summary.planned_table_frontage_m}m · Rack {summary.planned_rack_count}개 /{" "}
            {summary.planned_total_rack_levels}단
          </p>
        ) : null}
        {session ? (
          <div className="btn-row">
            <label className="file-label">
              현장 도착 사진
              <input type="file" accept="image/*" capture="environment" disabled={busy} onChange={(e) => void uploadPhoto("ARRIVAL", e.target.files)} />
            </label>
            <label className="file-label">
              세팅 완료 사진
              <input type="file" accept="image/*" capture="environment" disabled={busy} onChange={(e) => void uploadPhoto("COMPLETION", e.target.files)} />
            </label>
          </div>
        ) : null}
        {session?.arrival_recorded_at ? <p className="muted">도착 원본 {formatKstDateTime(session.arrival_recorded_at)}</p> : null}
        {session?.completed_recorded_at ? <p className="muted">완료 원본 {formatKstDateTime(session.completed_recorded_at)}</p> : null}
        {session?.duration_minutes != null ? <p>총 세팅시간 {session.duration_minutes}분</p> : null}
      </section>

      {isAdmin ? (
        <form className="card" onSubmit={(event) => void onSavePlan(event)}>
          <h2 className="section-title tight">세팅 계획</h2>
          <label>예정 시작</label>
          <input type="datetime-local" value={plan.start} onChange={(e) => setPlan({ ...plan, start: e.target.value })} />
          <label>완료 목표</label>
          <input type="datetime-local" value={plan.end} onChange={(e) => setPlan({ ...plan, end: e.target.value })} />
          <label>예정 인원</label>
          <input inputMode="numeric" value={plan.staff} onChange={(e) => setPlan({ ...plan, staff: e.target.value.replace(/[^\d]/g, "") })} />
          <label>세팅 책임자</label>
          <select value={plan.lead} onChange={(e) => setPlan({ ...plan, lead: e.target.value })}>
            <option value="">선택</option>
            {users.map((row) => (
              <option key={row.id} value={row.id}>
                {row.display_name}
              </option>
            ))}
          </select>
          <label>메모</label>
          <textarea value={plan.notes} onChange={(e) => setPlan({ ...plan, notes: e.target.value })} />
          <button type="submit" disabled={busy}>
            계획 저장
          </button>
        </form>
      ) : null}

      <section className="card">
        <h2 className="section-title tight">설치 물량</h2>
        {summary ? (
          <p>
            테이블 {summary.planned_table_count}개 · 총 전면길이 {summary.planned_table_frontage_m}m
            <br />
            렉 {summary.planned_rack_count}개 · 총 Rack 단수 {summary.planned_total_rack_levels}단
            <br />
            기타 집기 {summary.other_planned_count}개
          </p>
        ) : (
          <p className="muted">아직 설치 물량이 없습니다.</p>
        )}
        {fixtures.map((row) => (
          <article key={row.id} className="stack-row">
            <strong>
              {FIXTURE_TYPE_LABEL[row.fixture_type]} {row.name_snapshot}
            </strong>
            <span>
              {dimsLabel(row.width_mm, row.depth_mm, row.height_mm)} · 계획 {row.planned_quantity}개
              {row.fixture_type === "TABLE" ? ` · 전면 ${mmToMetersLabel((row.frontage_mm_per_unit ?? row.width_mm ?? 0) * row.planned_quantity)}` : ""}
              {row.fixture_type === "RACK" && row.rack_levels ? ` · ${row.rack_levels}단 · 총 ${row.rack_levels * row.planned_quantity}단` : ""}
            </span>
            <label>
              실제
              <input
                inputMode="numeric"
                defaultValue={row.actual_quantity ?? ""}
                onBlur={(e) => void onActualQty(row.id, e.target.value)}
              />
            </label>
          </article>
        ))}
      </section>

      {isAdmin && session ? (
        <form className="card" onSubmit={(event) => void onAddFixture(event)}>
          <h2 className="section-title tight">집기 추가</h2>
          <select value={fixtureForm.fixture_type} onChange={(e) => setFixtureForm({ ...fixtureForm, fixture_type: e.target.value as SetupFixtureType })}>
            {(Object.keys(FIXTURE_TYPE_LABEL) as SetupFixtureType[]).map((key) => (
              <option key={key} value={key}>
                {FIXTURE_TYPE_LABEL[key]}
              </option>
            ))}
          </select>
          <label>이름</label>
          <input value={fixtureForm.name_snapshot} onChange={(e) => setFixtureForm({ ...fixtureForm, name_snapshot: e.target.value })} required />
          <label>폭 mm</label>
          <input inputMode="numeric" value={fixtureForm.width_mm} onChange={(e) => setFixtureForm({ ...fixtureForm, width_mm: e.target.value })} />
          <label>깊이 mm</label>
          <input inputMode="numeric" value={fixtureForm.depth_mm} onChange={(e) => setFixtureForm({ ...fixtureForm, depth_mm: e.target.value })} />
          <label>높이 mm</label>
          <input inputMode="numeric" value={fixtureForm.height_mm} onChange={(e) => setFixtureForm({ ...fixtureForm, height_mm: e.target.value })} />
          <label>수량</label>
          <input inputMode="numeric" value={fixtureForm.planned_quantity} onChange={(e) => setFixtureForm({ ...fixtureForm, planned_quantity: e.target.value })} required />
          <label>렉 단수</label>
          <input inputMode="numeric" value={fixtureForm.rack_levels} onChange={(e) => setFixtureForm({ ...fixtureForm, rack_levels: e.target.value })} />
          <label>전면 mm/개 (비우면 폭)</label>
          <input inputMode="numeric" value={fixtureForm.frontage_mm_per_unit} onChange={(e) => setFixtureForm({ ...fixtureForm, frontage_mm_per_unit: e.target.value })} />
          <button type="submit" disabled={busy}>
            집기 추가
          </button>
        </form>
      ) : null}

      {session ? (
        <form className="card" onSubmit={(event) => void onActualStaff(event)}>
          <h2 className="section-title tight">실제 인원</h2>
          <input inputMode="numeric" value={actualStaff} onChange={(e) => setActualStaff(e.target.value.replace(/[^\d]/g, ""))} />
          <button type="submit" disabled={busy}>
            저장
          </button>
        </form>
      ) : null}

      {photos.length > 0 ? (
        <section className="card">
          <h2 className="section-title tight">세팅 사진</h2>
          <div className="photo-grid">
            {photos.map((photo) => (
              <figure key={photo.id}>
                {photo.signed_url ? <img src={photo.signed_url} alt={photo.photo_type} /> : <div className="placeholder">미리보기 없음</div>}
                <figcaption>
                  {photo.photo_type === "ARRIVAL" ? "도착" : photo.photo_type === "COMPLETION" ? "완료" : "기타"} · {formatKstDateTime(photo.recorded_at)}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      {isAdmin && session ? (
        <form className="card" onSubmit={(event) => void onAdjust(event)}>
          <h2 className="section-title tight">관리자 시간 보정</h2>
          <p className="muted">원본 시각은 바뀌지 않습니다.</p>
          {session.arrival_recorded_at ? <p>도착 원본 {formatKstDateTime(session.arrival_recorded_at)}</p> : null}
          {session.completed_recorded_at ? <p>완료 원본 {formatKstDateTime(session.completed_recorded_at)}</p> : null}
          <label>보정 도착</label>
          <input type="datetime-local" value={adjust.arrival} onChange={(e) => setAdjust({ ...adjust, arrival: e.target.value })} />
          <label>보정 완료</label>
          <input type="datetime-local" value={adjust.completed} onChange={(e) => setAdjust({ ...adjust, completed: e.target.value })} />
          <label>사유</label>
          <input value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} required />
          <button type="submit" disabled={busy}>
            보정 저장
          </button>
        </form>
      ) : null}

      {isAdmin ? (
        <form className="card" onSubmit={(event) => void onClosingGear(event)}>
          <h2 className="section-title tight">행사 종료 후 짐 처리 / 이동</h2>
          <label>목적지 종류</label>
          <select value={leg.to_kind} onChange={(e) => setLeg({ ...leg, to_kind: e.target.value as "location" | "event", to_location_id: "", to_event_id: "" })}>
            <option value="location">운영 거점</option>
            <option value="event">다음 행사</option>
          </select>
          {leg.to_kind === "location" ? (
            <>
              <label>목적지 거점</label>
              <select value={leg.to_location_id} onChange={(e) => setLeg({ ...leg, to_location_id: e.target.value })}>
                <option value="">거점 선택</option>
                {locations.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} ({OPERATION_LOCATION_LABEL[row.location_type]})
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <label>다음 행사</label>
              <select value={leg.to_event_id} onChange={(e) => setLeg({ ...leg, to_event_id: e.target.value })}>
                <option value="">행사 선택</option>
                {events
                  .filter((row) => row.id !== eventId)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.venue_name} · {row.name}
                    </option>
                  ))}
              </select>
            </>
          )}
          <label>대상</label>
          <select value={leg.movement_subject} onChange={(e) => setLeg({ ...leg, movement_subject: e.target.value as TransitionSubject })}>
            {(Object.keys(TRANSITION_SUBJECT_LABEL) as TransitionSubject[]).map((key) => (
              <option key={key} value={key}>
                {TRANSITION_SUBJECT_LABEL[key]}
              </option>
            ))}
          </select>
          <label>출발 예정</label>
          <input type="datetime-local" value={leg.depart} onChange={(e) => setLeg({ ...leg, depart: e.target.value })} />
          <label>도착 예정</label>
          <input type="datetime-local" value={leg.arrive} onChange={(e) => setLeg({ ...leg, arrive: e.target.value })} />
          <button type="submit" disabled={busy}>
            이동 기록
          </button>
        </form>
      ) : null}

      {transitions.length > 0 ? (
        <section className="card">
          <h2 className="section-title tight">이동 구간</h2>
          {transitions.map((row) => (
            <div key={row.id} className="muted">
              {TRANSITION_SUBJECT_LABEL[row.movement_subject]} · {row.from_event_id ? "행사" : "거점"} → {row.to_event_id ? "행사" : "거점"}
              {row.planned_departure_at && row.planned_arrival_at
                ? ` · ${formatKstDateTime(row.planned_departure_at)} → ${formatKstDateTime(row.planned_arrival_at)}`
                : ""}
            </div>
          ))}
        </section>
      ) : null}

      {members.length > 0 ? (
        <p className="muted">
          세팅 인원: {members.map((row) => `${row.display_name} (${SETUP_ROLE_LABEL[row.role]})`).join(", ")}
        </p>
      ) : null}
      {isAdmin ? <p className="muted">일정 확정 상태는 행사정보의 {SCHEDULE_STATUS_LABEL.CONFIRMED}/{SCHEDULE_STATUS_LABEL.TENTATIVE}와 별개입니다.</p> : null}
    </div>
  );
}
