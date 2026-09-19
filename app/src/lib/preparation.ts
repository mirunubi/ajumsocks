export type ItemType = "EQUIPMENT" | "CONSUMABLE";
export type PrepStatus = "NOT_READY" | "READY" | "ON_SITE" | "RETURNED";

export type PreparationItem = {
  id: string;
  name: string;
  item_type: ItemType;
  default_unit: string;
  requires_return: boolean;
  memo: string | null;
  sort_order: number;
  is_active: boolean;
};

export type PreparationSet = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

export type PreparationSetItem = {
  id: string;
  preparation_set_id: string;
  preparation_item_id: string;
  planned_quantity: number;
  sort_order: number;
  memo: string | null;
};

export type EventPrepPlan = {
  id: string;
  event_id: string;
  source_preparation_set_id: string | null;
  applied_by: string | null;
  applied_at: string;
};

export type EventPrepItem = {
  id: string;
  plan_id: string;
  event_id: string;
  source_preparation_item_id: string | null;
  item_name_snapshot: string;
  item_type_snapshot: ItemType;
  unit_snapshot: string;
  planned_quantity: number;
  requires_return: boolean;
  status: PrepStatus;
  memo: string | null;
  sort_order: number;
  updated_by: string | null;
  updated_at: string;
  removed_at: string | null;
};

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  EQUIPMENT: "집기",
  CONSUMABLE: "소모품",
};

export const PREP_STATUS_LABEL: Record<PrepStatus, string> = {
  NOT_READY: "미확인",
  READY: "준비완료",
  ON_SITE: "현장확인",
  RETURNED: "회수완료",
};

export function statusesFor(item: Pick<EventPrepItem, "requires_return">): PrepStatus[] {
  return item.requires_return ? ["NOT_READY", "READY", "ON_SITE", "RETURNED"] : ["NOT_READY", "READY", "ON_SITE"];
}

export function rank(status: PrepStatus) {
  if (status === "RETURNED") return 3;
  if (status === "ON_SITE") return 2;
  if (status === "READY") return 1;
  return 0;
}

export function prepProgress(items: EventPrepItem[]) {
  const active = items.filter((item) => !item.removed_at);
  const total = active.length;
  const ready = active.filter((item) => rank(item.status) >= 1).length;
  const onSite = active.filter((item) => rank(item.status) >= 2).length;
  const returnTarget = active.filter((item) => item.requires_return);
  const returned = returnTarget.filter((item) => item.status === "RETURNED").length;
  const incomplete = active.filter((item) => item.status === "NOT_READY");
  return { total, ready, onSite, returnTarget: returnTarget.length, returned, incomplete };
}

export function formatQty(quantity: number, unit: string) {
  const n = Number(quantity);
  const shown = Number.isInteger(n) ? String(n) : String(n);
  return `${shown}${unit}`;
}

export function daysUntil(iso: string, now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const start = new Date(`${fmt.format(new Date(iso))}T00:00:00+09:00`);
  const today = new Date(`${fmt.format(now)}T00:00:00+09:00`);
  return Math.round((start.getTime() - today.getTime()) / 86400000);
}
