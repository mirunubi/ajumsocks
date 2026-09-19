import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { datetimeLocalKstToIso } from "../lib/datetime";
import { CONTRACT_LABEL, EVENT_STATUS_LABEL, type ContractType, type EventStatus } from "../lib/events";
import { callEventAdmin } from "../lib/functions";

const emptyForm = {
  name: "",
  venue_name: "",
  address: "",
  address_detail: "",
  starts_at: "",
  ends_at: "",
  status: "PREPARING" as EventStatus,
  memo: "",
  contract_type: "NONE" as ContractType,
  commission_rate: "",
  fixed_fee: "",
  contract_memo: "",
};

export function EventNewScreen() {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await callEventAdmin({
        action: "create",
        name: form.name,
        venue_name: form.venue_name,
        address: form.address,
        address_detail: form.address_detail,
        starts_at: datetimeLocalKstToIso(form.starts_at),
        ends_at: datetimeLocalKstToIso(form.ends_at),
        status: form.status,
        memo: form.memo,
        contract_type: form.contract_type,
        commission_rate: form.commission_rate === "" ? null : Number(form.commission_rate),
        fixed_fee: form.fixed_fee === "" ? null : Number(form.fixed_fee),
        contract_memo: form.contract_memo,
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
    <div className="app-shell">
      <div className="nav-row">
        <Link to="/events">← 목록</Link>
        <div className="brand">새 행사</div>
      </div>
      <h1>행사 만들기</h1>
      <form className="card" onSubmit={(event) => void onSubmit(event)}>
        <label>행사명</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <label>행사장명</label>
        <input value={form.venue_name} onChange={(e) => setForm({ ...form, venue_name: e.target.value })} required />
        <label>주소</label>
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required />
        <label>상세주소</label>
        <input value={form.address_detail} onChange={(e) => setForm({ ...form, address_detail: e.target.value })} />
        <label>시작일시 (한국시간)</label>
        <input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} required />
        <label>종료일시 (한국시간)</label>
        <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} required />
        <label>상태</label>
        <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EventStatus })}>
          {(Object.keys(EVENT_STATUS_LABEL) as EventStatus[]).map((key) => (
            <option key={key} value={key}>
              {EVENT_STATUS_LABEL[key]}
            </option>
          ))}
        </select>
        <label>매대 계약</label>
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
            <input type="number" min={0} max={100} step="0.01" value={form.commission_rate} onChange={(e) => setForm({ ...form, commission_rate: e.target.value })} required />
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
        <label>행사 메모</label>
        <textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
        {message ? <div className="error">{message}</div> : null}
        <button type="submit" disabled={busy}>
          {busy ? "저장 중..." : "행사 만들기"}
        </button>
      </form>
    </div>
  );
}
