export type EventStatus = "PREPARING" | "ACTIVE" | "ENDED" | "SETTLED" | "CANCELLED";
export type ContractType = "NONE" | "COMMISSION" | "FIXED_FEE" | "MIXED";
export type AssignmentRole = "MANAGER" | "STAFF" | "PART_TIMER";
export type ContactType = "VENUE" | "HQ" | "OTHER";

export type EventRecord = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  status: EventStatus;
  venue_name: string;
  address: string;
  address_detail: string | null;
  memo: string | null;
  contract_type: ContractType;
  commission_rate: number | null;
  fixed_fee: number | null;
  contract_memo: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  event_members?: Array<{ count: number }>;
};

export type EventMember = {
  id: string;
  event_id: string;
  profile_id: string;
  assignment_role: AssignmentRole;
  created_at: string;
  display_name?: string;
  phone?: string;
  system_role?: string | null;
};

export type EventContact = {
  id: string;
  event_id: string;
  contact_type: ContactType;
  name: string;
  company: string | null;
  department: string | null;
  position: string | null;
  phone: string | null;
  memo: string | null;
  sort_order: number;
};

export type EventPhoto = {
  id: string;
  event_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  caption: string | null;
  photo_type: string;
  uploaded_by: string | null;
  created_at: string;
  signed_url?: string | null;
};

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  PREPARING: "준비중",
  ACTIVE: "진행중",
  ENDED: "종료",
  SETTLED: "정산완료",
  CANCELLED: "취소",
};

export const CONTRACT_LABEL: Record<ContractType, string> = {
  NONE: "없음",
  COMMISSION: "수수료형",
  FIXED_FEE: "입점비형",
  MIXED: "혼합형",
};

export const ASSIGNMENT_LABEL: Record<AssignmentRole, string> = {
  MANAGER: "관리자",
  STAFF: "직원",
  PART_TIMER: "알바",
};

export const CONTACT_LABEL: Record<ContactType, string> = {
  VENUE: "행사장 담당자",
  HQ: "본사 담당자",
  OTHER: "기타",
};

export const PHOTO_TYPE_LABEL: Record<string, string> = {
  location: "행사장 위치",
  parking: "주차장",
  entrance: "출입구",
  elevator: "엘리베이터",
  interior: "행사장 내부",
  booth: "매대 위치",
  install: "설치",
  notice: "안내문",
  other: "기타",
};

export function memberCount(event: EventRecord): number {
  return event.event_members?.[0]?.count ?? 0;
}

export function fullAddress(event: Pick<EventRecord, "address" | "address_detail">): string {
  return [event.address, event.address_detail].filter(Boolean).join(" ");
}

export function contractSummary(event: Pick<EventRecord, "contract_type" | "commission_rate" | "fixed_fee">): string {
  if (event.contract_type === "COMMISSION") return `매출 ${event.commission_rate}%`;
  if (event.contract_type === "FIXED_FEE") return `${Number(event.fixed_fee).toLocaleString("ko-KR")}원`;
  if (event.contract_type === "MIXED") {
    return `${Number(event.fixed_fee).toLocaleString("ko-KR")}원 + 매출 ${event.commission_rate}%`;
  }
  return "계약 없음";
}
