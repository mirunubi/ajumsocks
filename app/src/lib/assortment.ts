export type AssortmentSet = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

export type AssortmentRule = {
  id: string;
  assortment_set_id: string;
  category_id: string | null;
  include_descendants: boolean;
  tag_id: string | null;
  size_id: string | null;
  color_id: string | null;
  product_id: string | null;
  product_variant_id: string | null;
  sort_order: number;
  memo: string | null;
};

export type EventAssortment = {
  id: string;
  event_id: string;
  source_assortment_set_id: string | null;
  applied_at: string;
};

export type EventAssortmentItem = {
  id: string;
  event_assortment_id: string;
  event_id: string;
  product_id: string;
  product_variant_id: string;
  source_rule_id: string | null;
  source_type: "TEMPLATE" | "MANUAL";
  product_code_snapshot: string;
  product_name_snapshot: string;
  sku_code_snapshot: string;
  size_snapshot: string | null;
  color_snapshot: string | null;
  category_snapshot: string | null;
  sort_order: number;
  memo: string | null;
  removed_at: string | null;
};

export type PreviewSku = {
  product_variant_id: string;
  product_name: string;
  product_code: string;
  sku_code: string;
  size_name: string | null;
  color_name: string | null;
  category_path: string;
};

export function ruleSummary(
  rule: AssortmentRule,
  labels: {
    category: (id: string | null) => string;
    tag: (id: string | null) => string;
    size: (id: string | null) => string;
    color: (id: string | null) => string;
  },
) {
  const parts: string[] = [];
  if (rule.category_id) {
    parts.push(labels.category(rule.category_id) + (rule.include_descendants ? " (하위포함)" : ""));
  }
  if (rule.tag_id) parts.push(`Tag ${labels.tag(rule.tag_id)}`);
  if (rule.size_id) parts.push(`Size ${labels.size(rule.size_id)}`);
  if (rule.color_id) parts.push(`Color ${labels.color(rule.color_id)}`);
  if (rule.product_id) parts.push("지정 상품");
  if (rule.product_variant_id) parts.push("지정 SKU");
  return parts.join(" + ") || "조건 없음";
}
