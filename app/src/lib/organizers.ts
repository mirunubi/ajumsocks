import type { ContactType, ContractType } from "./events";

export type Organizer = {
  id: string;
  name: string;
  calendar_color: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  terms?: OrganizerTerms | null;
  contact_count?: number;
};

export type OrganizerTerms = {
  organizer_id: string;
  default_contract_type: ContractType;
  default_commission_rate: number | null;
  default_fixed_fee: number | null;
  memo: string | null;
  updated_at?: string;
};

export type OrganizerContact = {
  id: string;
  organizer_id: string;
  contact_type: ContactType;
  name: string;
  department: string | null;
  position: string | null;
  phone: string | null;
  email: string | null;
  memo: string | null;
  sort_order: number;
  is_active: boolean;
};

export type CalendarEvent = {
  id: string;
  name: string;
  venue_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  organizer_id: string | null;
  organizer_name: string | null;
  organizer_color: string | null;
};

export const ORGANIZER_PALETTE = [
  { name: "Purple", hex: "#7C3AED" },
  { name: "Blue", hex: "#2563EB" },
  { name: "Green", hex: "#16A34A" },
  { name: "Orange", hex: "#EA580C" },
  { name: "Red", hex: "#DC2626" },
  { name: "Teal", hex: "#0D9488" },
  { name: "Brown", hex: "#92400E" },
  { name: "Pink", hex: "#DB2777" },
  { name: "Indigo", hex: "#4338CA" },
  { name: "Gray", hex: "#6B7280" },
  { name: "Gold", hex: "#CA8A04" },
  { name: "Cyan", hex: "#0891B2" },
] as const;

export function contrastText(hex: string): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#241714";
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luma = (r * 299 + g * 587 + b * 114) / 1000;
  return luma > 155 ? "#241714" : "#ffffff";
}
