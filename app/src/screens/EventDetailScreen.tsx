import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { Profile } from "../lib/access";
import { combineKstDateTime, formatKstDateTime, formatKstRange, kstHm, scheduleHint, splitKstDateTime } from "../lib/datetime";
import {
  ASSIGNMENT_LABEL,
  CONTACT_LABEL,
  CONTRACT_LABEL,
  EVENT_STATUS_LABEL,
  PHOTO_TYPE_LABEL,
  contractSummary,
  fullAddress,
  type AssignmentRole,
  type ContactType,
  type EventContact,
  type EventMember,
  type EventPhoto,
  type EventRecord,
  type EventStatus,
} from "../lib/events";
import { callEventAdmin, callEventPhotos, callOrganizerAdmin, callUserAdmin } from "../lib/functions";
import type { Organizer } from "../lib/organizers";
import { EventAssortmentPanel } from "./EventAssortmentPanel";
import { EventBasicsFields, type EventBasicsValue } from "./EventBasicsFields";
import { EventFinancePanel } from "./EventFinancePanel";
import { EventInventoryPanel } from "./EventInventoryPanel";
import { EventSetupPanel } from "./EventSetupPanel";
import { EventPrepPanel } from "./EventPrepPanel";
import { formatE164Display } from "../lib/phone";
import { SCHEDULE_STATUS_LABEL, type ScheduleStatus } from "../lib/operations";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/session";

type Detail = {
  event: EventRecord;
  organizer: { id: string; name: string; calendar_color: string; is_active: boolean } | null;
  members: EventMember[];
  contacts: EventContact[];
  photos: EventPhoto[];
};

type Tab = "info" | "prep" | "ops" | "inventory" | "finance";

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function EventDetailScreen() {
  const { id = "" } = useParams();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "ADMIN";
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [memberForm, setMemberForm] = useState({ profile_id: "", assignment_role: "STAFF" as AssignmentRole });
  const [contactForm, setContactForm] = useState({
    contact_type: "VENUE" as ContactType,
    name: "",
    company: "",
    department: "",
    position: "",
    phone: "",
    email: "",
    memo: "",
  });
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("info");
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EventBasicsValue | null>(null);
  const [organizers, setOrganizers] = useState<Organizer[]>([]);

  const refresh = useCallback(async () => {
    const result = await callEventAdmin({ action: "get", id });
    setDetail(result as Detail);
  }, [id]);

  useEffect(() => {
    void refresh().catch((error: Error) => {
      if (error.message === "not_found") setMissing(true);
      else setMessage(error.message);
    });
  }, [refresh]);

  useEffect(() => {
    if (!isAdmin) return;
    void callUserAdmin({ action: "list" })
      .then((result) => setUsers(result.users as Profile[]))
      .catch((error: Error) => setMessage(error.message));
    void callOrganizerAdmin({ action: "list" })
      .then((result) => setOrganizers((result.organizers ?? []) as Organizer[]))
      .catch((error: Error) => setMessage(error.message));
  }, [isAdmin]);

  async function flashCopy(label: string, value: string) {
    await copyText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  }

  function startEdit(event: EventRecord) {
    const start = splitKstDateTime(event.starts_at);
    const end = splitKstDateTime(event.ends_at);
    setEditForm({
      name: event.name,
      organizer_id: event.organizer_id ?? "",
      venue_name: event.venue_name,
      address: event.address,
      address_detail: event.address_detail ?? "",
      start_date: start.date,
      start_time: start.time,
      end_date: end.date,
      end_time: end.time,
      memo: event.memo ?? "",
      contract_type: event.contract_type,
      commission_rate: event.commission_rate == null ? "" : String(event.commission_rate),
      fixed_fee: event.fixed_fee == null ? "" : String(event.fixed_fee),
      contract_memo: event.contract_memo ?? "",
    });
    setEditing(true);
  }

  async function onSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editForm) return;
    setBusy(true);
    setMessage(null);
    try {
      await callEventAdmin({
        action: "update",
        id,
        name: editForm.name,
        organizer_id: editForm.organizer_id || null,
        venue_name: editForm.venue_name,
        address: editForm.address,
        address_detail: editForm.address_detail,
        starts_at: combineKstDateTime(editForm.start_date, editForm.start_time),
        ends_at: combineKstDateTime(editForm.end_date, editForm.end_time),
        memo: editForm.memo,
        contract_type: editForm.contract_type,
        commission_rate: editForm.commission_rate === "" ? null : Number(editForm.commission_rate),
        fixed_fee: editForm.fixed_fee === "" ? null : Number(editForm.fixed_fee),
        contract_memo: editForm.contract_memo,
      });
      setEditing(false);
      setEditForm(null);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "수정 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveMember(member: EventMember) {
    const name = member.display_name || "이 사용자";
    if (!window.confirm(`${name}님을 이 행사에서 해제하시겠습니까?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await callEventAdmin({ action: "remove-member", event_id: id, profile_id: member.profile_id });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "해제 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onAssign(event: FormEvent) {
    event.preventDefault();
    if (!memberForm.profile_id) return;
    setBusy(true);
    setMessage(null);
    try {
      await callEventAdmin({
        action: "add-member",
        event_id: id,
        profile_id: memberForm.profile_id,
        assignment_role: memberForm.assignment_role,
      });
      setMemberForm({ ...memberForm, profile_id: "" });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "배정 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onAddContact(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await callEventAdmin({ action: "add-contact", event_id: id, ...contactForm });
      setContactForm({ contact_type: "VENUE", name: "", company: "", department: "", position: "", phone: "", email: "", memo: "" });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "담당자 등록 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onStatus(status: EventStatus) {
    setBusy(true);
    setMessage(null);
    try {
      await callEventAdmin({ action: "set-status", id, status });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상태 변경 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onSchedule(schedule_status: ScheduleStatus) {
    setBusy(true);
    setMessage(null);
    try {
      await callEventAdmin({ action: "set-schedule-status", id, schedule_status });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "일정 확정 변경 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMessage(null);
    try {
      for (const file of [...files]) {
        const signed = await callEventPhotos({
          action: "sign-upload",
          event_id: id,
          original_filename: file.name,
          mime_type: file.type,
          file_size: file.size,
        });
        const { error } = await supabase.storage
          .from("event-photos")
          .uploadToSignedUrl(signed.storage_path, signed.token, file, { contentType: file.type });
        if (error) throw error;
        await callEventPhotos({
          action: "complete-upload",
          event_id: id,
          storage_path: signed.storage_path,
          original_filename: file.name,
          mime_type: file.type,
          file_size: file.size,
        });
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사진 업로드 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onDeletePhoto(photoId: string) {
    setBusy(true);
    setMessage(null);
    try {
      await callEventPhotos({ action: "delete", id: photoId });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사진 삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <div className="app-shell">
        <div className="nav-row">
          <Link to="/">← 홈</Link>
          <div className="brand">행사</div>
        </div>
        <h1>행사를 찾을 수 없습니다</h1>
        <p className="muted">배정되지 않은 행사이거나 없는 행사입니다.</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="app-shell center">
        <p className="muted">{message || "불러오는 중..."}</p>
      </div>
    );
  }

  const { event, organizer, members, contacts, photos } = detail;
  const address = fullAddress(event);
  const phones = [
    ...contacts.filter((row) => row.phone).map((row) => ({ label: row.name, phone: row.phone as string })),
    ...members.filter((row) => row.phone).map((row) => ({ label: row.display_name || "담당", phone: row.phone as string })),
  ];
  const assignedIds = new Set(members.map((row) => row.profile_id));
  const organizerOptions = organizers.slice();
  if (organizer && !organizerOptions.some((row) => row.id === organizer.id)) {
    organizerOptions.unshift({
      id: organizer.id,
      name: organizer.name,
      calendar_color: organizer.calendar_color,
      is_active: organizer.is_active,
    });
  }
  const memberGroups: AssignmentRole[] = ["STAFF", "PART_TIMER", "MANAGER"];


  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to={isAdmin ? "/admin" : "/my-events"}>{isAdmin ? "← 일정" : "← 내 행사"}</Link>
        <div className="brand">행사</div>
      </div>

      <h1>{event.name}</h1>
      <p className="muted">{event.venue_name}</p>
      <div>
        <span className="badge">{EVENT_STATUS_LABEL[event.status]}</span>
        <span className="badge">{SCHEDULE_STATUS_LABEL[(event.schedule_status ?? "CONFIRMED") as ScheduleStatus]}</span>
        <span className="badge">{scheduleHint(event.starts_at, event.ends_at)}</span>
        <span className="badge">{organizer?.name || "주최자 미지정"}</span>
      </div>
      <p className="muted">{formatKstRange(event.starts_at, event.ends_at)}</p>
      {copied ? <p className="copied">{copied} 복사됨</p> : null}
      {message ? <div className="error">{message}</div> : null}

      <nav className="tab-row">
        {(
          [
            ["info", "행사정보"],
            ["prep", "행사준비"],
            ["ops", "세팅·이동"],
            ["inventory", "재고"],
            ["finance", "매출·지출"],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button type="button" key={id} className={tab === id ? "chip active" : "chip"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "info" ? (
        <>
      {isAdmin && editing && editForm ? (
        <form className="card" onSubmit={(event) => void onSaveEdit(event)}>
          <h2 className="section-title tight">행사정보 수정</h2>
          <EventBasicsFields
            form={editForm}
            organizers={organizerOptions}
            onChange={(patch) => setEditForm((prev) => (prev ? { ...prev, ...patch } : prev))}
            organizerHint={
              editForm.organizer_id !== (event.organizer_id ?? "") ? (
                <p className="muted">
                  주최자를 변경합니다. 현재 행사 계약조건과 담당자 정보는 기존 Snapshot을 유지합니다.
                </p>
              ) : (
                <p className="muted">주최자만 바꿔도 계약 Snapshot과 담당자 Snapshot은 자동으로 바뀌지 않습니다.</p>
              )
            }
          />
          <div className="btn-row">
            <button className="secondary" type="button" disabled={busy} onClick={() => { setEditing(false); setEditForm(null); }}>
              취소
            </button>
            <button type="submit" disabled={busy}>
              {busy ? "저장 중..." : "저장"}
            </button>
          </div>
        </form>
      ) : null}

      {isAdmin && !editing ? (
        <button type="button" className="secondary" disabled={busy} onClick={() => startEdit(event)}>
          행사정보 수정
        </button>
      ) : null}

      <section className="card">
        <div className="muted">기간</div>
        <div>
          시작 {formatKstDateTime(event.starts_at)} ({kstHm(event.starts_at)})
        </div>
        <div>
          종료 {formatKstDateTime(event.ends_at)} ({kstHm(event.ends_at)})
        </div>
      </section>

      <section className="card">
        <div className="muted">주소</div>
        <button type="button" className="copy-block" onClick={() => void flashCopy("주소", address)}>
          {address}
        </button>
      </section>

      <section className="card">
        <div className="muted">담당자 전화</div>
        {phones.length === 0 ? <p className="muted">등록된 전화번호가 없습니다.</p> : null}
        {phones.map((row) => (
          <div className="phone-row" key={`${row.label}-${row.phone}`}>
            <a href={`tel:${row.phone}`}>{row.label}</a>
            <span>{formatE164Display(row.phone)}</span>
            <button type="button" className="tiny" onClick={() => void flashCopy("전화", row.phone)}>
              복사
            </button>
          </div>
        ))}
      </section>

      <section>
        <h2 className="section-title">행사 사진</h2>
        {photos.length === 0 ? <div className="placeholder">아직 사진이 없습니다.</div> : null}
        <div className="photo-grid">
          {photos.map((photo) => (
            <figure key={photo.id}>
              {photo.signed_url ? <img src={photo.signed_url} alt={photo.caption || photo.original_filename} /> : <div className="placeholder">미리보기 없음</div>}
              <figcaption>
                {PHOTO_TYPE_LABEL[photo.photo_type] || photo.photo_type}
                {photo.caption ? ` · ${photo.caption}` : ""}
              </figcaption>
              {isAdmin ? (
                <button type="button" className="tiny danger" disabled={busy} onClick={() => void onDeletePhoto(photo.id)}>
                  삭제
                </button>
              ) : null}
            </figure>
          ))}
        </div>
        {isAdmin || members.some((row) => row.profile_id === profile?.id) ? (
          <label className="file-label">
            사진 올리기
            <input type="file" accept="image/*" multiple disabled={busy} onChange={(e) => void onUpload(e.target.files)} />
          </label>
        ) : null}
      </section>

      <section className="card">
        <h2 className="section-title tight">주최자</h2>
        <div>{organizer?.name || "주최자 미지정"}</div>
      </section>

      <section className="card">
        <h2 className="section-title tight">내부 담당자</h2>
        {members.length === 0 ? <p className="muted">아직 배정된 사람이 없습니다.</p> : null}
        {memberGroups.map((role) => {
          const rows = members.filter((member) => member.assignment_role === role);
          if (rows.length === 0) return null;
          return (
            <div key={role}>
              <div className="muted">{ASSIGNMENT_LABEL[role]}</div>
              {rows.map((member) => (
                <div className="stack-row" key={member.id}>
                  <strong>{member.display_name}</strong>
                  {member.phone ? <span>{formatE164Display(member.phone)}</span> : null}
                  {isAdmin ? (
                    <button type="button" className="tiny danger" disabled={busy} onClick={() => void onRemoveMember(member)}>
                      해제
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2 className="section-title tight">행사 당시 담당자</h2>
        {contacts.length === 0 ? <p className="muted">등록된 외부 담당자가 없습니다.</p> : null}
        {contacts.map((contact) => (
          <div className="stack-row" key={contact.id}>
            <strong>{contact.name}</strong>
            <span className="badge">{CONTACT_LABEL[contact.contact_type]}</span>
            <div className="muted">
              {[contact.company, contact.department, contact.position].filter(Boolean).join(" / ")}
            </div>
            {contact.phone ? <div>{formatE164Display(contact.phone)}</div> : null}
            {contact.email ? <div className="muted">{contact.email}</div> : null}
            {contact.memo ? <div className="muted">{contact.memo}</div> : null}
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="section-title tight">매대 계약</h2>
        <div>{CONTRACT_LABEL[event.contract_type]}</div>
        {isAdmin ? <div>{contractSummary(event)}</div> : null}
        {isAdmin && event.contract_memo ? <p className="muted">{event.contract_memo}</p> : null}
      </section>

      {event.memo ? (
        <section className="card">
          <h2 className="section-title tight">메모</h2>
          <p>{event.memo}</p>
        </section>
      ) : null}

      {isAdmin ? (
        <>
          <form className="card" onSubmit={(event) => void onAssign(event)}>
            <h2 className="section-title tight">인력 배정</h2>
            <select value={memberForm.profile_id} onChange={(e) => setMemberForm({ ...memberForm, profile_id: e.target.value })} required>
              <option value="">사용자 선택</option>
              {users
                .filter((user) => !assignedIds.has(user.id))
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.display_name} ({user.role})
                  </option>
                ))}
            </select>
            <select
              value={memberForm.assignment_role}
              onChange={(e) => setMemberForm({ ...memberForm, assignment_role: e.target.value as AssignmentRole })}
            >
              {(Object.keys(ASSIGNMENT_LABEL) as AssignmentRole[]).map((key) => (
                <option key={key} value={key}>
                  {ASSIGNMENT_LABEL[key]}
                </option>
              ))}
            </select>
            <p className="muted">시스템 역할과 행사 역할은 다릅니다. 로그인 기간은 자동으로 바뀌지 않습니다.</p>
            <button type="submit" disabled={busy}>
              배정
            </button>
          </form>

          <form className="card" onSubmit={(event) => void onAddContact(event)}>
            <h2 className="section-title tight">외부 담당자 추가</h2>
            <select
              value={contactForm.contact_type}
              onChange={(e) => setContactForm({ ...contactForm, contact_type: e.target.value as ContactType })}
            >
              {(Object.keys(CONTACT_LABEL) as ContactType[]).map((key) => (
                <option key={key} value={key}>
                  {CONTACT_LABEL[key]}
                </option>
              ))}
            </select>
            <label>이름</label>
            <input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} required />
            <label>전화</label>
            <input value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} />
            <label>이메일</label>
            <input value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} />
            <label>회사 / 백화점</label>
            <input value={contactForm.company} onChange={(e) => setContactForm({ ...contactForm, company: e.target.value })} />
            <label>부서</label>
            <input value={contactForm.department} onChange={(e) => setContactForm({ ...contactForm, department: e.target.value })} />
            <label>직책</label>
            <input value={contactForm.position} onChange={(e) => setContactForm({ ...contactForm, position: e.target.value })} />
            <label>메모</label>
            <textarea value={contactForm.memo} onChange={(e) => setContactForm({ ...contactForm, memo: e.target.value })} />
            <button type="submit" disabled={busy}>
              담당자 추가
            </button>
          </form>

          <section className="card">
            <h2 className="section-title tight">업무 상태</h2>
            <select value={event.status} disabled={busy} onChange={(e) => void onStatus(e.target.value as EventStatus)}>
              {(Object.keys(EVENT_STATUS_LABEL) as EventStatus[]).map((key) => (
                <option key={key} value={key}>
                  {EVENT_STATUS_LABEL[key]}
                </option>
              ))}
            </select>
            <label>일정 확정</label>
            <select
              value={event.schedule_status ?? "CONFIRMED"}
              disabled={busy}
              onChange={(e) => void onSchedule(e.target.value as ScheduleStatus)}
            >
              {(Object.keys(SCHEDULE_STATUS_LABEL) as ScheduleStatus[]).map((key) => (
                <option key={key} value={key}>
                  {SCHEDULE_STATUS_LABEL[key]}
                </option>
              ))}
            </select>
            <p className="muted">날짜가 지나도 상태는 자동으로 바뀌지 않습니다. 예정/확정은 운영 상태와 별개입니다.</p>
          </section>
        </>
      ) : null}
        </>
      ) : null}

      {tab === "prep" ? (
        <>
          <h2 className="section-title">집기·운영물품</h2>
          <EventPrepPanel eventId={event.id} isAdmin={isAdmin} startsAt={event.starts_at} />
          <h2 className="section-title">판매상품</h2>
          <EventAssortmentPanel eventId={event.id} isAdmin={isAdmin} />
        </>
      ) : null}
      {tab === "ops" ? <EventSetupPanel eventId={event.id} isAdmin={isAdmin} eventName={event.name} /> : null}
      {tab === "inventory" ? <EventInventoryPanel eventId={event.id} /> : null}
      {tab === "finance" ? (
        <EventFinancePanel eventId={event.id} isAdmin={isAdmin} startsAt={event.starts_at} endsAt={event.ends_at} />
      ) : null}
    </div>
  );
}