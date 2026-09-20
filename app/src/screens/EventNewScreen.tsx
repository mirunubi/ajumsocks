import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { combineKstDateTime } from "../lib/datetime";
import { CONTRACT_LABEL, type ContractType, type EventStatus } from "../lib/events";
import { callEventAdmin, callOrganizerAdmin } from "../lib/functions";
import type { Organizer, OrganizerContact, OrganizerTerms } from "../lib/organizers";
import { AdminChrome } from "./AdminChrome";

export function EventNewScreen() {
  const navigate = useNavigate();
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [contacts, setContacts] = useState<OrganizerContact[]>([]);
  const [copyIds, setCopyIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    organizer_id: "",
    venue_name: "",
    address: "",
    address_detail: "",
    start_date: "",
    start_time: "10:30",
    end_date: "",
    end_time: "20:00",
    status: "PREPARING" as EventStatus,
    memo: "",
    contract_type: "NONE" as ContractType,
    commission_rate: "",
    fixed_fee: "",
    contract_memo: "",
  });

  useEffect(() => {
    void callOrganizerAdmin({ action: "list" })
      .then((result) => {
        const rows = ((result.organizers ?? []) as Organizer[]).filter((row) => row.is_active);
        setOrganizers(rows);
      })
      .catch((error: Error) => setMessage(error.message));
  }, []);

  async function onOrganizer(id: string) {
    setForm((prev) => ({ ...prev, organizer_id: id }));
    setCopyIds([]);
    setContacts([]);
    if (!id) return;
    try {
      const result = await callOrganizerAdmin({ action: "get", id });
      const terms = result.terms as OrganizerTerms | null;
      const orgContacts = ((result.contacts ?? []) as OrganizerContact[]).filter((row) => row.is_active);
      setContacts(orgContacts);
      setCopyIds(orgContacts.map((row) => row.id));
      if (terms) {
        setForm((prev) => ({
          ...prev,
          organizer_id: id,
          contract_type: terms.default_contract_type,
          commission_rate: terms.default_commission_rate == null ? "" : String(terms.default_commission_rate),
          fixed_fee: terms.default_fixed_fee == null ? "" : String(terms.default_fixed_fee),
          contract_memo: terms.memo ?? "",
        }));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "주최자 조회 실패");
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await callEventAdmin({
        action: "create",
        name: form.name,
        organizer_id: form.organizer_id,
        venue_name: form.venue_name,
        address: form.address,
        address_detail: form.address_detail,
        starts_at: combineKstDateTime(form.start_date, form.start_time),
        ends_at: combineKstDateTime(form.end_date, form.end_time),
        status: form.status,
        memo: form.memo,
        contract_type: form.contract_type,
        commission_rate: form.commission_rate === "" ? null : Number(form.commission_rate),
        fixed_fee: form.fixed_fee === "" ? null : Number(form.fixed_fee),
        contract_memo: form.contract_memo,
        copy_contact_ids: copyIds,
      });
      navigate(`/events/${result.event.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  const showRate = form.contract_type === "COMMISSION" || form.contract_type === "MIXED";
  const showFee = form.contract_type === "FIXED_FEE" || form.contract_type === "MIXED";

  return (
    <AdminChrome title="행사 만들기">
      <Link to="/admin">← 일정</Link>
      <form className="card" onSubmit={(event) => void onSubmit(event)}>
        <label>행사명</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <label>주최자</label>
        <select value={form.organizer_id} onChange={(e) => void onOrganizer(e.target.value)} required>
          <option value="">주최자 선택</option>
          {organizers.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        <label>행사장명</label>
        <input value={form.venue_name} onChange={(e) => setForm({ ...form, venue_name: e.target.value })} required />
        <label>주소</label>
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required />
        <label>상세주소</label>
        <input value={form.address_detail} onChange={(e) => setForm({ ...form, address_detail: e.target.value })} />
        <div className="filters">
          <div>
            <label>시작일</label>
            <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
          </div>
          <div>
            <label>시작시간</label>
            <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required />
          </div>
          <div>
            <label>종료일</label>
            <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} required />
          </div>
          <div>
            <label>종료시간</label>
            <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} required />
          </div>
        </div>
        <label>매대 계약 (이번 행사 Snapshot)</label>
        <select value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value as ContractType })}>
          {(Object.keys(CONTRACT_LABEL) as ContractType[]).map((key) => (
            <option key={key} value={key}>
              {CONTRACT_LABEL[key]}
            </option>
          ))}
        </select>
        {showRate ? (
          <>
            <label>수수료 (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={form.commission_rate}
              onChange={(e) => setForm({ ...form, commission_rate: e.target.value })}
              required
            />
          </>
        ) : null}
        {showFee ? (
          <>
            <label>입점비 (원)</label>
            <input type="number" min={0} step="1" value={form.fixed_fee} onChange={(e) => setForm({ ...form, fixed_fee: e.target.value })} required />
          </>
        ) : null}
        <label>계약 메모</label>
        <textarea value={form.contract_memo} onChange={(e) => setForm({ ...form, contract_memo: e.target.value })} />
        {contacts.length > 0 ? (
          <>
            <h2 className="section-title">주최자 담당자 복사</h2>
            {contacts.map((contact) => (
              <label key={contact.id}>
                <input
                  type="checkbox"
                  checked={copyIds.includes(contact.id)}
                  onChange={(e) =>
                    setCopyIds((prev) => (e.target.checked ? [...prev, contact.id] : prev.filter((id) => id !== contact.id)))
                  }
                />{" "}
                {contact.name} ({contact.contact_type})
              </label>
            ))}
          </>
        ) : null}
        <label>행사 메모</label>
        <textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
        {message ? <div className="error">{message}</div> : null}
        <button type="submit" disabled={busy}>
          {busy ? "저장 중..." : "행사 만들기"}
        </button>
      </form>
    </AdminChrome>
  );
}
