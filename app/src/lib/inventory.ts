export type RemainderLevel = "ZERO" | "VERY_LOW" | "HALF" | "HIGH" | "FULL";
export type CheckKind = "OPENING" | "ROUTINE" | "CLOSING";
export type CheckScope = "FULL" | "PARTIAL";
export type CheckStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";

export const REMAINDER_OPTIONS: Array<{ id: RemainderLevel; label: string }> = [
  { id: "ZERO", label: "0" },
  { id: "VERY_LOW", label: "1~2" },
  { id: "HALF", label: "약 5" },
  { id: "HIGH", label: "약 7~8" },
  { id: "FULL", label: "약 10" },
];

export const REMAINDER_MID: Record<RemainderLevel, number> = {
  ZERO: 0,
  VERY_LOW: 2,
  HALF: 5,
  HIGH: 8,
  FULL: 10,
};

export const KIND_LABEL: Record<CheckKind, string> = {
  OPENING: "시작 실사",
  ROUTINE: "중간 실사",
  CLOSING: "종료 실사",
};

export const SCOPE_LABEL: Record<CheckScope, string> = {
  FULL: "전체",
  PARTIAL: "부분",
};

export const STATUS_LABEL: Record<CheckStatus, string> = {
  DRAFT: "작성중",
  CONFIRMED: "확정",
  CANCELLED: "취소",
};

export type InventoryCheck = {
  id: string;
  event_id: string;
  check_kind: CheckKind;
  check_scope: CheckScope;
  status: CheckStatus;
  started_at: string;
  updated_at?: string;
  confirmed_at: string | null;
};

export type InventoryLine = {
  id: string;
  product_variant_id: string;
  event_assortment_item_id?: string;
  pack_size_snapshot: number;
  full_pack_count: number | null;
  remainder_level: RemainderLevel | null;
  updated_at?: string;
  product_name: string;
  product_code: string;
  sku_code: string;
  size_name: string | null;
  color_name: string | null;
  category_name: string | null;
  image_url?: string | null;
  estimated_qty: number | null;
  previous_full_pack_count?: number | null;
  previous_remainder_level?: RemainderLevel | null;
  previous_estimated_qty?: number | null;
  delta_qty?: number | null;
  source_check_id?: string;
  updated_at_current?: string;
  operational_estimated_qty?: number | null;
};

export type InventoryLineFilter = {
  onlyOpen: boolean;
  query?: string;
  category?: string;
  size?: string;
  color?: string;
};

export function isInventoryLineOpen(item: Pick<InventoryLine, "full_pack_count">) {
  return item.full_pack_count == null;
}

export function filterInventoryLines<T extends InventoryLine>(items: T[], filter: InventoryLineFilter): T[] {
  const q = (filter.query ?? "").trim().toLowerCase();
  return items.filter((item) => {
    if (filter.onlyOpen && !isInventoryLineOpen(item)) return false;
    if (filter.category && (item.category_name || "미분류") !== filter.category) return false;
    if (filter.size && item.size_name !== filter.size) return false;
    if (filter.color && item.color_name !== filter.color) return false;
    if (!q) return true;
    return (
      item.product_name.toLowerCase().includes(q) ||
      item.product_code.toLowerCase().includes(q) ||
      item.sku_code.toLowerCase().includes(q)
    );
  });
}

/** After saving `savedId`, pick the next SKU. Never uses array index arithmetic on the pre-save list. */
export function nextOpenInventoryItem<T extends InventoryLine>(items: T[], savedId: string, filter: InventoryLineFilter): T | null {
  const filtered = filterInventoryLines(items, filter);
  if (filtered.length === 0) return null;
  if (filter.onlyOpen) return filtered[0];
  const idx = filtered.findIndex((item) => item.id === savedId || item.product_variant_id === savedId);
  if (idx < 0) return filtered[0];
  return filtered[idx + 1] ?? null;
}

export function estimatedQty(pack: number, full: number | null, remainder: RemainderLevel | null) {
  if (full == null || remainder == null) return null;
  return full * pack + REMAINDER_MID[remainder];
}

export function remainderLabel(level: RemainderLevel | null | undefined) {
  if (!level) return "미입력";
  return REMAINDER_OPTIONS.find((row) => row.id === level)?.label ?? level;
}

export function stockLabel(full: number | null, remainder: RemainderLevel | null, pack = 10) {
  if (full == null || remainder == null) return "미입력";
  const est = estimatedQty(pack, full, remainder);
  return `${full}묶음 + ${remainderLabel(remainder)} · 약 ${est}개`;
}

export function deltaLabel(delta: number | null | undefined) {
  if (delta == null) return null;
  const sign = delta > 0 ? "+" : "";
  return `약 ${sign}${delta}`;
}
