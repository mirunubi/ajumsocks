export type Product = {
  id: string;
  product_code: string;
  name: string;
  primary_category_id: string | null;
  manufacturer_name: string | null;
  wholesaler_name: string | null;
  country_of_origin: string | null;
  purchase_price: number | string | null;
  sale_price: number | string | null;
  default_pack_quantity: number;
  is_active: boolean;
  memo: string | null;
  created_at?: string;
  updated_at?: string;
  category_name?: string | null;
  sku_count?: number;
  primary_image_url?: string | null;
};

export type Category = {
  id: string;
  parent_id: string | null;
  name: string;
  code: string;
  sort_order: number;
  is_active: boolean;
};

export type Size = {
  id: string;
  code: string;
  display_name: string;
  sort_order: number;
  is_active: boolean;
};

export type Color = {
  id: string;
  code: string;
  name: string;
  color_family: string | null;
  sort_order: number;
  is_active: boolean;
};

export type AttributeDefinition = {
  id: string;
  code: string;
  name: string;
  value_type: "TEXT" | "NUMBER" | "BOOLEAN" | "SELECT";
  unit: string | null;
  option_values: string[];
  is_active: boolean;
};

export type ProductAttributeValue = {
  id: string;
  product_id: string;
  attribute_definition_id: string;
  value_text: string | null;
  value_number: number | string | null;
  value_boolean: boolean | null;
  option_value: string | null;
  attribute_definitions?: AttributeDefinition;
};

export type Tag = {
  id: string;
  name: string;
};

export type ProductVariant = {
  id: string;
  product_id: string;
  sku_code: string;
  size_id: string | null;
  primary_color_id: string | null;
  is_active: boolean;
  memo: string | null;
  sizes?: { code: string; display_name: string } | null;
  colors?: { code: string; name: string } | null;
};

export type ProductImage = {
  id: string;
  product_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  image_type: string;
  is_primary: boolean;
  signed_url: string | null;
};

export type ProductMasters = {
  categories: Category[];
  sizes: Size[];
  colors: Color[];
  attributes: AttributeDefinition[];
  tags: Tag[];
};

export type ProductDetail = {
  product: Product;
  category_path: string[];
  variants: ProductVariant[];
  images: ProductImage[];
  attributes: ProductAttributeValue[];
  tags: Tag[];
};

export const COUNTRY_LABEL: Record<string, string> = {
  KR: "한국",
  CN: "중국",
  JP: "일본",
  OTHER: "기타",
};

export const IMAGE_TYPE_LABEL: Record<string, string> = {
  front: "전면",
  back: "후면",
  pattern: "패턴 확대",
  package: "포장사진",
  other: "기타",
};

export function formatPrice(value: number | string | null | undefined) {
  if (value == null || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${n.toLocaleString("ko-KR")}원`;
}

export function categoryLabel(categories: Category[], id: string | null | undefined) {
  if (!id) return "-";
  const byId = new Map(categories.map((cat) => [cat.id, cat]));
  const parts: string[] = [];
  let cursor: string | null | undefined = id;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const cat = byId.get(cursor);
    if (!cat) break;
    parts.unshift(cat.name);
    cursor = cat.parent_id;
  }
  return parts.join(" > ") || "-";
}

export function skuLabel(variant: ProductVariant) {
  const size = variant.sizes?.display_name ?? "-";
  const color = variant.colors?.name ?? "-";
  return `${size} / ${color}`;
}
