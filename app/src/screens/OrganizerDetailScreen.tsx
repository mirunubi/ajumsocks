import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CONTACT_LABEL, CONTRACT_LABEL, type ContactType, type ContractType } from "../lib/events";
import { callOrganizerAdmin } from "../lib/functions";
import { ORGANIZER_PALETTE, type Organizer, type OrganizerContact, type OrganizerTerms } from "../lib/organizers";
import { formatE164Display } from "../lib/phone";
import { AdminChrome } from "./AdminChrome";

const emptyTerms = {
  default_contract_type: "NONE" as ContractType,
  default_commission_rate: "",
  default_fixed_fee: "",
  memo: "",
};

export function OrganizerDetailScreen() {
  const { id = "" } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(ORGANIZER_PALETTE[0].hex);
  const [isActive, setIsActive] = useState(true);
  const [terms, setTerms] = useState(emptyTerms);
  const [contacts, setContacts] = useState<OrganizerContact[]>([]);
  const [contactForm, setContactForm] = useState({
    contact_type: "HQ" as ContactType,
    name: "",
    department: "",
    position: "",
    phone: "",
    email: "",
    memo: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (isNew) return;
    const result = await callOrganizerAdmin({ action: "get", id });
    const organizer = result.organizer as Organizer;
    const saved = result.terms as OrganizerTerms | null;
    setName(organizer.name);
    setColor(organizer.calendar_color);
    setIsActive(organizer.is_active);
    setTerms({
      default_contract_type: saved?.default_contract_type ?? "NONE",
      default_commission_rate: saved?.default_commission_rate == null ? "" : String(saved.default_commission_rate),
      default_fixed_fee: saved?.default_fixed_fee == null ? "" : String(saved.default_fixed_fee),
      memo: saved?.memo ?? "",
    });
    setContacts((result.contacts ?? []) as OrganizerContact[]);
  }, [id, isNew]);

  useEffect(() => {
    void load().catch((error: Error) => setMessage(error.message));
  }, [load]);

  const showRate = terms.default_contract_type === "COMMISSION" || terms.default_contract_type === "MIXED";
  const showFee = terms.default_contract_type === "FIXED_FEE" || terms.default_contract_type === "MIXED";

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const payload = {
        name,
        calendar_color: color,
        is_active: isActive,
        default_contract_type: terms.default_contract_type,
        default_commission_rate: terms.default_commission_rate === "" ? null : Number(terms.default_commission_rate),
        default_fixed_fee: terms.default_fixed_fee === "" ? null : Number(terms.default_fixed_fee),
        memo: terms.memo,
      };
      if (isNew) {
        const created = await callOrganizerAdmin({ action: "create", ...payload });
        navigate(`/organizers/${created.organizer.id}`, { replace: true });
        return;
      }
      await callOrganizerAdmin({ action: "update", id, name, calendar_color: color, is_active: isActive });
      await callOrganizerAdmin({ action: "upsert-terms", organizer_id: id, ...payload });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onAddContact(event: FormEvent) {
    event.preventDefault();
    if (isNew) return;
    setBusy(true);
    setMessage(null);
    try {
      await callOrganizerAdmin({ action: "add-contact", organizer_id: id, ...contactForm });
      setContactForm({ contact_type: "HQ", name: "", department: "", position: "", phone: "", email: "", memo: "" });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "담당자 저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onDeactivate(contactId: string) {
    setBusy(true);
    try {
      await callOrganizerAdmin({ action: "deactivate-contact", id: contactId });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "비활성화 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminChrome title={isNew ? "주최자 등록" : "주최자 상세"}>
      <Link to="/organizers">← 목록</Link>
      {message ? <div className="error">{message}</div> : null}
      <form className="card" onSubmit={(event) => void onSave(event)}>
        <h2 className="section-title tight">기본정보</h2>
        <label>주최자명</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        <label>캘린더 색상</label>
        <div className="palette">
          {ORGANIZER_PALETTE.map((item) => (
            <button
              type="button"
              key={item.hex}
              className={`palette-swatch ${color === item.hex ? "on" : ""}`}
              style={{ background: item.hex }}
              onClick={() => setColor(item.hex)}
              aria-label={item.name}
            />
          ))}
        </div>
        <label>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> 활성
        </label>
        <h2 className="section-title">기본 계약조건</h2>
        <p className="muted">기본값은 새 행사에만 복사됩니다. 이미 만든 행사 계약은 바뀌지 않습니다.</p>
        <select
          value={terms.default_contract_type}
          onChange={(e) => setTerms({ ...terms, default_contract_type: e.target.value as ContractType })}
        >
          {(Object.keys(CONTRACT_LABEL) as ContractType[]).map((key) => (
            <option key={key} value={key}>
              {CONTRACT_LABEL[key]}
            </option>
          ))}
        </select>
        {showRate ? (
          <>
            <label>기본 수수료 (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={terms.default_commission_rate}
              onChange={(e) => setTerms({ ...terms, default_commission_rate: e.target.value })}
              required
            />
          </>
        ) : null}
        {showFee ? (
          <>
            <label>기본 입점비 (원)</label>
            <input
              type="number"
              min={0}
              step="1"
              value={terms.default_fixed_fee}
              onChange={(e) => setTerms({ ...terms, default_fixed_fee: e.target.value })}
              required
            />
          </>
        ) : null}
        <label>계약 메모</label>
        <textarea value={terms.memo} onChange={(e) => setTerms({ ...terms, memo: e.target.value })} />
        <button type="submit" disabled={busy}>
          {busy ? "저장 중..." : "저장"}
        </button>
      </form>

      {!isNew ? (
        <>
          <section className="card">
            <h2 className="section-title tight">담당자</h2>
            {contacts.length === 0 ? <p className="muted">등록된 담당자가 없습니다.</p> : null}
            {contacts.map((contact) => (
              <div className="stack-row" key={contact.id}>
                <strong>{contact.name}</strong>
                <span className="badge">{CONTACT_LABEL[contact.contact_type]}</span>
                {!contact.is_active ? <span className="badge">비활성</span> : null}
                <div className="muted">{[contact.department, contact.position].filter(Boolean).join(" / ")}</div>
                {contact.phone ? <div>{formatE164Display(contact.phone)}</div> : null}
                {contact.email ? <div className="muted">{contact.email}</div> : null}
                {contact.is_active ? (
                  <button type="button" className="tiny" disabled={busy} onClick={() => void onDeactivate(contact.id)}>
                    비활성화
                  </button>
                ) : null}
              </div>
            ))}
          </section>
          <form className="card" onSubmit={(event) => void onAddContact(event)}>
            <h2 className="section-title tight">담당자 추가</h2>
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
            <label>부서</label>
            <input value={contactForm.department} onChange={(e) => setContactForm({ ...contactForm, department: e.target.value })} />
            <label>직책</label>
            <input value={contactForm.position} onChange={(e) => setContactForm({ ...contactForm, position: e.target.value })} />
            <label>전화</label>
            <input value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} />
            <label>이메일</label>
            <input value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} />
            <label>메모</label>
            <textarea value={contactForm.memo} onChange={(e) => setContactForm({ ...contactForm, memo: e.target.value })} />
            <button type="submit" disabled={busy}>
              담당자 추가
            </button>
          </form>
        </>
      ) : null}
    </AdminChrome>
  );
}
