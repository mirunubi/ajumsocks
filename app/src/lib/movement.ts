export type LocationType = "HQ" | "EVENT" | "TEMP" | "THIRD_PARTY";
export type MovementStatus = "DRAFT" | "DISPATCHED" | "RECEIVED" | "CANCELLED";

export const LOCATION_TYPE_LABEL: Record<LocationType, string> = {
  HQ: "본사",
  EVENT: "행사",
  TEMP: "임시보관",
  THIRD_PARTY: "제3장소",
};

export const MOVEMENT_STATUS_LABEL: Record<MovementStatus, string> = {
  DRAFT: "작성중",
  DISPATCHED: "출발",
  RECEIVED: "도착",
  CANCELLED: "취소",
};

export type InventoryLocation = {
  id: string;
  location_type: LocationType;
  name: string;
  event_id: string | null;
  address: string | null;
  is_active: boolean;
};

export type MovementRecord = {
  id: string;
  movement_no: string;
  source_location_id: string;
  destination_location_id: string;
  status: MovementStatus;
  created_at: string;
  source?: InventoryLocation | null;
  destination?: InventoryLocation | null;
};

export function approxLabel(units: number | null | undefined) {
  if (units == null) return "없음";
  return `약 ${units}개`;
}
