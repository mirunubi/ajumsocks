import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { combineKstDateTime } from "../lib/datetime";
import { type ContractType, type EventStatus } from "../lib/events";
import { callEventAdmin, callOrganizerAdmin } from "../lib/functions";
import type { Organizer, OrganizerContact, OrganizerTerms } from "../lib/organizers";
import { AdminChrome } from "./AdminChrome";
import { EventBasicsFields } from "./EventBasicsFields";

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

  return (
    <AdminChrome title="행사 만들기">
      <Link to="/admin">← 일정</Link>
      <form className="card" onSubmit={(event) => void onSubmit(event)}>
        <EventBasicsFields
          form={form}
          organizers={organizers}
          organizerRequired
          onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          onOrganizerChange={(id) => void onOrganizer(id)}
        />
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
        {message ? <div className="error">{message}</div> : null}
        <button type="submit" disabled={busy}>
          {busy ? "저장 중..." : "행사 만들기"}
        </button>
      </form>
    </AdminChrome>
  );
}
