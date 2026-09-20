import type { ReactNode } from "react";
import { CONTRACT_LABEL, type ContractType } from "../lib/events";
import type { Organizer } from "../lib/organizers";

export type EventBasicsValue = {
  name: string;
  organizer_id: string;
  venue_name: string;
  address: string;
  address_detail: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  memo: string;
  contract_type: ContractType;
  commission_rate: string;
  fixed_fee: string;
  contract_memo: string;
};

export function EventBasicsFields({
  form,
  organizers,
  onChange,
  onOrganizerChange,
  organizerRequired = false,
  organizerHint,
}: {
  form: EventBasicsValue;
  organizers: Organizer[];
  onChange: (patch: Partial<EventBasicsValue>) => void;
  onOrganizerChange?: (id: string) => void;
  organizerRequired?: boolean;
  organizerHint?: ReactNode;
}) {
  const showRate = form.contract_type === "COMMISSION" || form.contract_type === "MIXED";
  const showFee = form.contract_type === "FIXED_FEE" || form.contract_type === "MIXED";

  return (
    <>
      <label>행사명</label>
      <input value={form.name} onChange={(e) => onChange({ name: e.target.value })} required />
      <label>주최자</label>
      <select
        value={form.organizer_id}
        required={organizerRequired}
        onChange={(e) => {
          const id = e.target.value;
          if (onOrganizerChange) onOrganizerChange(id);
          else onChange({ organizer_id: id });
        }}
      >
        <option value="">주최자 선택</option>
        {organizers.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
            {org.is_active ? "" : " (비활성)"}
          </option>
        ))}
      </select>
      {organizerHint}
      <label>행사장명</label>
      <input value={form.venue_name} onChange={(e) => onChange({ venue_name: e.target.value })} required />
      <label>주소</label>
      <input value={form.address} onChange={(e) => onChange({ address: e.target.value })} required />
      <label>상세주소</label>
      <input value={form.address_detail} onChange={(e) => onChange({ address_detail: e.target.value })} />
      <div className="filters">
        <div>
          <label>시작일</label>
          <input type="date" value={form.start_date} onChange={(e) => onChange({ start_date: e.target.value })} required />
        </div>
        <div>
          <label>시작시간</label>
          <input type="time" value={form.start_time} onChange={(e) => onChange({ start_time: e.target.value })} required />
        </div>
        <div>
          <label>종료일</label>
          <input type="date" value={form.end_date} onChange={(e) => onChange({ end_date: e.target.value })} required />
        </div>
        <div>
          <label>종료시간</label>
          <input type="time" value={form.end_time} onChange={(e) => onChange({ end_time: e.target.value })} required />
        </div>
      </div>
      <label>매대 계약 (이번 행사 Snapshot)</label>
      <select value={form.contract_type} onChange={(e) => onChange({ contract_type: e.target.value as ContractType })}>
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
            onChange={(e) => onChange({ commission_rate: e.target.value })}
            required
          />
        </>
      ) : null}
      {showFee ? (
        <>
          <label>입점비 (원)</label>
          <input type="number" min={0} step="1" value={form.fixed_fee} onChange={(e) => onChange({ fixed_fee: e.target.value })} required />
        </>
      ) : null}
      <label>계약 메모</label>
      <textarea value={form.contract_memo} onChange={(e) => onChange({ contract_memo: e.target.value })} />
      <label>행사 메모</label>
      <textarea value={form.memo} onChange={(e) => onChange({ memo: e.target.value })} />
    </>
  );
}
