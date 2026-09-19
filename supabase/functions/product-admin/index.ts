import { json, preflight } from "../_shared/http.ts";
import { hasAppAccess } from "../_shared/crypto.ts";
import { callerUserId, secretClient } from "../_shared/supabase.ts";

type AppRole = "ADMIN" | "STAFF" | "PART_TIMER";
type Profile = {
  id: string;
  role: AppRole;
  is_active: boolean;
  login_allowed_from: string | null;
  login_allowed_until: string | null;
};

const COUNTRIES = new Set(["KR", "CN", "JP", "OTHER"]);
const VALUE_TYPES = new Set(["TEXT", "NUMBER", "BOOLEAN", "SELECT"]);
const IMAGE_TYPES = new Set(["front", "back", "pattern", "package", "other"]);
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);
const MAX_BYTES = 10 * 1024 * 1024;
const SIGNED_TTL = 3600;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  try {
    const callerId = await callerUserId(req);
    if (!callerId) return json(req, { error: "unauthorized" }, 401);
    const service = secretClient();
    const { data: caller, error } = await service.from("profiles").select("*").eq("id", callerId).maybeSingle();
    if (error) throw error;
    if (!caller || !hasAppAccess(caller as Profile)) return json(req, { error: "forbidden" }, 403);

    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const isAdmin = caller.role === "ADMIN";

    if (action === "list-masters") return await listMasters(req, service);
    if (action === "list-products") return await listProducts(req, service, body);
    if (action === "get") return await getProduct(req, service, body);

    if (!isAdmin) return json(req, { error: "forbidden" }, 403);
    if (action === "create") return await createProduct(req, service, callerId, body);
    if (action === "update") return await updateProduct(req, service, body);
    if (action === "add-variant") return await addVariant(req, service, body);
    if (action === "update-variant") return await updateVariant(req, service, body);
    if (action === "set-attribute") return await setAttribute(req, service, body);
    if (action === "add-tag") return await addTag(req, service, body);
    if (action === "remove-tag") return await removeTag(req, service, body);
    if (action === "sign-upload") return await signUpload(req, service, body);
    if (action === "complete-upload") return await completeUpload(req, service, callerId, body);
    if (action === "set-primary-image") return await setPrimaryImage(req, service, body);
    if (action === "delete-image") return await deleteImage(req, service, body);
    return json(req, { error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "server_error";
    return json(req, { error: message }, 500);
  }
});

function text(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function uuidOrNull(value: unknown) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v || v === "null" || v === "undefined") return null;
  return v;
}

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function pgCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) return String((error as { code: string }).code);
  return "";
}

async function listMasters(req: Request, service: ReturnType<typeof secretClient>) {
  const [categories, sizes, colors, attributes, tags] = await Promise.all([
    service.from("product_categories").select("*").order("sort_order"),
    service.from("sizes").select("*").order("sort_order"),
    service.from("colors").select("*").order("sort_order"),
    service.from("attribute_definitions").select("*").order("sort_order"),
    service.from("tags").select("*").order("name"),
  ]);
  const firstError = [categories, sizes, colors, attributes, tags].find((item) => item.error)?.error;
  if (firstError) return json(req, { error: firstError.message }, 400);
  return json(req, {
    categories: categories.data ?? [],
    sizes: sizes.data ?? [],
    colors: colors.data ?? [],
    attributes: attributes.data ?? [],
    tags: tags.data ?? [],
  });
}

function descendantIds(categories: Array<{ id: string; parent_id: string | null }>, root: string) {
  const ids = new Set<string>([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const cat of categories) {
      if (cat.parent_id && ids.has(cat.parent_id) && !ids.has(cat.id)) {
        ids.add(cat.id);
        changed = true;
      }
    }
  }
  return [...ids];
}

async function listProducts(
  req: Request,
  service: ReturnType<typeof secretClient>,
  body: Record<string, unknown>,
) {
  const q = text(body.q);
  const categoryId = uuidOrNull(body.category_id);
  const sizeId = uuidOrNull(body.size_id);
  const colorId = uuidOrNull(body.primary_color_id ?? body.color_id);
  const activeFilter = body.is_active;
  const wantActive = activeFilter === true || activeFilter === false ? Boolean(activeFilter) : null;

  let query = service.from("products").select("*").order("created_at", { ascending: false });
  if (wantActive != null) query = query.eq("is_active", wantActive);

  if (categoryId) {
    const { data: cats } = await service.from("product_categories").select("id, parent_id");
    const ids = descendantIds((cats ?? []) as Array<{ id: string; parent_id: string | null }>, categoryId);
    query = query.in("primary_category_id", ids);
  }

  const { data: products, error } = await query;
  if (error) return json(req, { error: error.message }, 400);
  let rows = products ?? [];

  const productIds = rows.map((row) => row.id as string);
  const [{ data: variants }, { data: images }, { data: categories }] = await Promise.all([
    productIds.length
      ? service.from("product_variants").select("id, product_id, sku_code, size_id, primary_color_id, is_active")
        .in("product_id", productIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    productIds.length
      ? service.from("product_images").select("id, product_id, storage_path, is_primary, sort_order")
        .in("product_id", productIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    service.from("product_categories").select("id, name, parent_id"),
  ]);

  const variantRows = variants ?? [];
  let matchedIds: Set<string> | null = null;
  if (q) {
    const lower = q.toLowerCase();
    matchedIds = new Set(
      rows
        .filter((row) =>
          String(row.name).toLowerCase().includes(lower) ||
          String(row.product_code).toLowerCase().includes(lower)
        )
        .map((row) => row.id as string),
    );
    for (const variant of variantRows) {
      if (String(variant.sku_code).toLowerCase().includes(lower)) {
        matchedIds.add(variant.product_id as string);
      }
    }
    rows = rows.filter((row) => matchedIds!.has(row.id as string));
  }

  if (sizeId || colorId) {
    const byProduct = new Set<string>();
    for (const variant of variantRows) {
      if (sizeId && variant.size_id !== sizeId) continue;
      if (colorId && variant.primary_color_id !== colorId) continue;
      byProduct.add(variant.product_id as string);
    }
    rows = rows.filter((row) => byProduct.has(row.id as string));
  }

  const catMap = new Map((categories ?? []).map((cat) => [cat.id as string, cat]));
  const countMap = new Map<string, number>();
  for (const variant of variantRows) {
    countMap.set(variant.product_id as string, (countMap.get(variant.product_id as string) ?? 0) + 1);
  }

  const primaryByProduct = new Map<string, { storage_path: string }>();
  for (const image of images ?? []) {
    if (image.is_primary) primaryByProduct.set(image.product_id as string, { storage_path: image.storage_path as string });
  }

  const listed = await Promise.all(rows.map(async (row) => {
    const primary = primaryByProduct.get(row.id as string);
    let signed_url: string | null = null;
    if (primary) {
      const { data } = await service.storage.from("product-images").createSignedUrl(primary.storage_path, SIGNED_TTL);
      signed_url = data?.signedUrl ?? null;
    }
    const cat = catMap.get(row.primary_category_id as string);
    return {
      ...row,
      category_name: cat?.name ?? null,
      sku_count: countMap.get(row.id as string) ?? 0,
      primary_image_url: signed_url,
    };
  }));

  return json(req, { products: listed });
}

async function loadProduct(service: ReturnType<typeof secretClient>, id: string) {
  const { data: product, error } = await service.from("products").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!product) return null;

  const [variants, images, attrs, productTags, categories] = await Promise.all([
    service.from("product_variants").select("*, sizes(code, display_name), colors(code, name)")
      .eq("product_id", id)
      .order("created_at"),
    service.from("product_images").select("*").eq("product_id", id).order("sort_order").order("created_at"),
    service.from("product_attribute_values")
      .select("*, attribute_definitions(code, name, value_type, unit, option_values)")
      .eq("product_id", id),
    service.from("product_tags").select("tag_id, tags(id, name)").eq("product_id", id),
    service.from("product_categories").select("id, name, parent_id"),
  ]);

  const signedImages = await Promise.all((images.data ?? []).map(async (image) => {
    const { data } = await service.storage.from("product-images").createSignedUrl(image.storage_path, SIGNED_TTL);
    return { ...image, signed_url: data?.signedUrl ?? null };
  }));

  const catMap = new Map((categories.data ?? []).map((cat) => [cat.id as string, cat]));
  const path: string[] = [];
  let cursor = product.primary_category_id as string | null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const cat = catMap.get(cursor);
    if (!cat) break;
    path.unshift(cat.name as string);
    cursor = (cat.parent_id as string | null) ?? null;
  }

  return {
    product,
    category_path: path,
    variants: variants.data ?? [],
    images: signedImages,
    attributes: attrs.data ?? [],
    tags: (productTags.data ?? []).map((row) => row.tags).filter(Boolean),
  };
}

async function getProduct(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const payload = await loadProduct(service, id);
  if (!payload) return json(req, { error: "not_found" }, 404);
  return json(req, payload);
}

function parseProductFields(body: Record<string, unknown>, partial: boolean) {
  const name = text(body.name);
  if (!partial && !name) return { error: "name_required" as const };
  const purchase_price = money(body.purchase_price);
  const sale_price = money(body.sale_price);
  if (Number.isNaN(purchase_price) || Number.isNaN(sale_price)) return { error: "invalid_price" as const };
  if (purchase_price != null && purchase_price < 0) return { error: "invalid_price" as const };
  if (sale_price != null && sale_price < 0) return { error: "invalid_price" as const };

  const packRaw = body.default_pack_quantity;
  let default_pack_quantity: number | undefined;
  if (packRaw === null || packRaw === undefined || packRaw === "") {
    default_pack_quantity = partial ? undefined : 10;
  } else {
    default_pack_quantity = Number(packRaw);
    if (!Number.isInteger(default_pack_quantity) || default_pack_quantity <= 0) {
      return { error: "invalid_pack_quantity" as const };
    }
  }

  const country = text(body.country_of_origin);
  if (country && !COUNTRIES.has(country)) return { error: "invalid_country" as const };

  const fields: Record<string, unknown> = {};
  if (!partial || body.name !== undefined) fields.name = name;
  if (!partial || body.primary_category_id !== undefined) {
    fields.primary_category_id = uuidOrNull(body.primary_category_id);
  }
  if (!partial || body.manufacturer_name !== undefined) {
    fields.manufacturer_name = text(body.manufacturer_name) || null;
  }
  if (!partial || body.wholesaler_name !== undefined) {
    fields.wholesaler_name = text(body.wholesaler_name) || null;
  }
  if (!partial || body.country_of_origin !== undefined) {
    fields.country_of_origin = country || null;
  }
  if (!partial || body.purchase_price !== undefined) fields.purchase_price = purchase_price;
  if (!partial || body.sale_price !== undefined) fields.sale_price = sale_price;
  if (default_pack_quantity !== undefined) fields.default_pack_quantity = default_pack_quantity;
  if (!partial || body.memo !== undefined) fields.memo = text(body.memo) || null;
  if (body.is_active === true || body.is_active === false) fields.is_active = body.is_active;
  return { fields };
}

async function createProduct(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const parsed = parseProductFields(body, false);
  if ("error" in parsed) return json(req, { error: parsed.error }, 400);

  let product_code = text(body.product_code);
  if (product_code) {
    const { data: existing } = await service.from("products").select("id").eq("product_code", product_code).maybeSingle();
    if (existing) return json(req, { error: "duplicate_product_code" }, 409);
  } else {
    const { data, error } = await service.rpc("next_product_code");
    if (error || !data) return json(req, { error: error?.message ?? "code_failed" }, 500);
    product_code = String(data);
  }

  const { data: product, error } = await service
    .from("products")
    .insert({ ...parsed.fields, product_code, created_by: callerId })
    .select("*")
    .maybeSingle();
  if (error) {
    if (pgCode(error) === "23505") return json(req, { error: "duplicate_product_code" }, 409);
    return json(req, { error: error.message }, 400);
  }
  if (!product) return json(req, { error: "create_failed" }, 500);

  const size_id = uuidOrNull(body.size_id);
  const primary_color_id = uuidOrNull(body.primary_color_id ?? body.color_id);
  if (size_id || primary_color_id || body.create_sku === true) {
    const sku = await insertVariant(service, product.id as string, {
      size_id,
      primary_color_id,
      sku_code: text(body.sku_code) || null,
      memo: text(body.sku_memo) || null,
    });
    if ("error" in sku) {
      return json(req, { product, variant_error: sku.error }, sku.status);
    }
  }

  const payload = await loadProduct(service, product.id as string);
  return json(req, payload);
}

async function updateProduct(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const parsed = parseProductFields(body, true);
  if ("error" in parsed) return json(req, { error: parsed.error }, 400);
  if (Object.keys(parsed.fields).length === 0) return json(req, { error: "invalid_input" }, 400);

  const { data, error } = await service.from("products").update(parsed.fields).eq("id", id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_found" }, 404);
  const payload = await loadProduct(service, id);
  return json(req, payload);
}

async function insertVariant(
  service: ReturnType<typeof secretClient>,
  product_id: string,
  input: { size_id: string | null; primary_color_id: string | null; sku_code: string | null; memo: string | null },
) {
  let sku_code = input.sku_code;
  if (sku_code) {
    const { data: existing } = await service.from("product_variants").select("id").eq("sku_code", sku_code).maybeSingle();
    if (existing) return { error: "duplicate_sku_code", status: 409 as const };
  } else {
    const { data, error } = await service.rpc("next_sku_code", { p_product_id: product_id });
    if (error || !data) return { error: error?.message ?? "sku_code_failed", status: 500 as const };
    sku_code = String(data);
  }

  const { data, error } = await service
    .from("product_variants")
    .insert({
      product_id,
      sku_code,
      size_id: input.size_id,
      primary_color_id: input.primary_color_id,
      memo: input.memo,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    if (pgCode(error) === "23505") return { error: "duplicate_sku_code", status: 409 as const };
    return { error: error.message, status: 400 as const };
  }
  return { variant: data };
}

async function addVariant(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const product_id = text(body.product_id);
  if (!product_id) return json(req, { error: "invalid_input" }, 400);
  const { data: product } = await service.from("products").select("id").eq("id", product_id).maybeSingle();
  if (!product) return json(req, { error: "not_found" }, 404);

  const result = await insertVariant(service, product_id, {
    size_id: uuidOrNull(body.size_id),
    primary_color_id: uuidOrNull(body.primary_color_id ?? body.color_id),
    sku_code: text(body.sku_code) || null,
    memo: text(body.memo) || null,
  });
  if ("error" in result) return json(req, { error: result.error }, result.status);
  const payload = await loadProduct(service, product_id);
  return json(req, { ...payload, variant: result.variant });
}

async function updateVariant(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const patch: Record<string, unknown> = {};
  if (body.size_id !== undefined) patch.size_id = uuidOrNull(body.size_id);
  if (body.primary_color_id !== undefined || body.color_id !== undefined) {
    patch.primary_color_id = uuidOrNull(body.primary_color_id ?? body.color_id);
  }
  if (body.memo !== undefined) patch.memo = text(body.memo) || null;
  if (body.is_active === true || body.is_active === false) patch.is_active = body.is_active;
  if (Object.keys(patch).length === 0) return json(req, { error: "invalid_input" }, 400);

  const { data, error } = await service.from("product_variants").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_found" }, 404);
  const payload = await loadProduct(service, data.product_id as string);
  return json(req, payload);
}

async function setAttribute(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const product_id = text(body.product_id);
  const attribute_definition_id = text(body.attribute_definition_id);
  if (!product_id || !attribute_definition_id) return json(req, { error: "invalid_input" }, 400);

  const { data: def } = await service.from("attribute_definitions").select("*").eq("id", attribute_definition_id)
    .maybeSingle();
  if (!def) return json(req, { error: "not_found" }, 404);
  if (!VALUE_TYPES.has(String(def.value_type))) return json(req, { error: "invalid_attribute" }, 400);

  const row: Record<string, unknown> = {
    product_id,
    attribute_definition_id,
    value_text: null,
    value_number: null,
    value_boolean: null,
    option_value: null,
  };

  const type = String(def.value_type);
  if (type === "TEXT") {
    row.value_text = text(body.value_text ?? body.value) || null;
    if (!row.value_text) return json(req, { error: "invalid_attribute_value" }, 400);
  } else if (type === "NUMBER") {
    const n = Number(body.value_number ?? body.value);
    if (!Number.isFinite(n)) return json(req, { error: "invalid_attribute_value" }, 400);
    row.value_number = n;
  } else if (type === "BOOLEAN") {
    if (body.value_boolean !== true && body.value_boolean !== false && body.value !== true && body.value !== false) {
      return json(req, { error: "invalid_attribute_value" }, 400);
    }
    row.value_boolean = body.value_boolean === true || body.value === true;
  } else {
    const option = text(body.option_value ?? body.value);
    const options = (def.option_values as string[]) ?? [];
    if (!option || (options.length > 0 && !options.includes(option))) {
      return json(req, { error: "invalid_attribute_value" }, 400);
    }
    row.option_value = option;
  }

  const { data: existing } = await service
    .from("product_attribute_values")
    .select("id")
    .eq("product_id", product_id)
    .eq("attribute_definition_id", attribute_definition_id)
    .maybeSingle();

  if (existing && body.allow_update !== true) {
    return json(req, { error: "duplicate_attribute" }, 409);
  }

  const writer = existing
    ? service.from("product_attribute_values").update(row).eq("id", existing.id)
    : service.from("product_attribute_values").insert(row);
  const { error } = await writer.select("*").maybeSingle();
  if (error) {
    if (pgCode(error) === "23505") return json(req, { error: "duplicate_attribute" }, 409);
    return json(req, { error: error.message }, 400);
  }
  const payload = await loadProduct(service, product_id);
  return json(req, payload);
}

async function addTag(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const product_id = text(body.product_id);
  if (!product_id) return json(req, { error: "invalid_input" }, 400);
  let tag_id = uuidOrNull(body.tag_id);
  const name = text(body.name);
  if (!tag_id && !name) return json(req, { error: "invalid_input" }, 400);

  if (!tag_id) {
    const { data: found } = await service.from("tags").select("*").eq("name", name).maybeSingle();
    if (found) tag_id = found.id as string;
    else {
      const { data: created, error } = await service.from("tags").insert({ name }).select("*").maybeSingle();
      if (error) {
        if (pgCode(error) === "23505") return json(req, { error: "duplicate_tag" }, 409);
        return json(req, { error: error.message }, 400);
      }
      tag_id = created?.id as string;
    }
  }

  const { error } = await service.from("product_tags").insert({ product_id, tag_id });
  if (error) {
    if (pgCode(error) === "23505") return json(req, { error: "duplicate_tag" }, 409);
    return json(req, { error: error.message }, 400);
  }
  const payload = await loadProduct(service, product_id);
  return json(req, payload);
}

async function removeTag(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const product_id = text(body.product_id);
  const tag_id = text(body.tag_id);
  if (!product_id || !tag_id) return json(req, { error: "invalid_input" }, 400);
  const { error } = await service.from("product_tags").delete().eq("product_id", product_id).eq("tag_id", tag_id);
  if (error) return json(req, { error: error.message }, 400);
  const payload = await loadProduct(service, product_id);
  return json(req, payload);
}

function safeFilename(name: string) {
  const base = name.replace(/[/\\]/g, "").replace(/[^\w.\-가-힣]+/g, "_").slice(0, 80);
  return base || "photo";
}

async function signUpload(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const product_id = text(body.product_id);
  const original_filename = text(body.original_filename) || "photo";
  const mime_type = text(body.mime_type);
  const file_size = Number(body.file_size ?? 0);
  if (!product_id || !ALLOWED_MIME.has(mime_type) || !Number.isFinite(file_size) || file_size <= 0 || file_size > MAX_BYTES) {
    return json(req, { error: "invalid_input" }, 400);
  }
  const { data: product } = await service.from("products").select("id").eq("id", product_id).maybeSingle();
  if (!product) return json(req, { error: "not_found" }, 404);

  const storage_path = `${product_id}/${crypto.randomUUID()}_${safeFilename(original_filename)}`;
  const { data, error } = await service.storage.from("product-images").createSignedUploadUrl(storage_path);
  if (error || !data) return json(req, { error: error?.message ?? "sign_failed" }, 400);
  return json(req, { storage_path, token: data.token, signed_url: data.signedUrl });
}

async function completeUpload(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const product_id = text(body.product_id);
  const storage_path = text(body.storage_path);
  const original_filename = text(body.original_filename) || "photo";
  const mime_type = text(body.mime_type);
  const file_size = Number(body.file_size ?? 0);
  const image_type = text(body.image_type) || "other";
  const wantPrimary = body.is_primary === true;
  if (!product_id || !storage_path.startsWith(`${product_id}/`)) {
    return json(req, { error: "invalid_input" }, 400);
  }
  if (!ALLOWED_MIME.has(mime_type) || !IMAGE_TYPES.has(image_type)) {
    return json(req, { error: "invalid_input" }, 400);
  }
  if (!Number.isFinite(file_size) || file_size <= 0 || file_size > MAX_BYTES) {
    return json(req, { error: "invalid_input" }, 400);
  }

  const { data: objectInfo, error: headError } = await service.storage
    .from("product-images")
    .createSignedUrl(storage_path, 30);
  if (headError || !objectInfo?.signedUrl) {
    return json(req, { error: "upload_missing" }, 400);
  }

  const { count } = await service
    .from("product_images")
    .select("id", { count: "exact", head: true })
    .eq("product_id", product_id);
  const is_primary = wantPrimary || (count ?? 0) === 0;

  if (is_primary) {
    const { error: clearError } = await service
      .from("product_images")
      .update({ is_primary: false })
      .eq("product_id", product_id)
      .eq("is_primary", true);
    if (clearError) return json(req, { error: clearError.message }, 400);
  }

  const { data, error } = await service
    .from("product_images")
    .insert({
      product_id,
      storage_path,
      original_filename,
      mime_type,
      file_size,
      image_type,
      is_primary,
      uploaded_by: callerId,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    await service.storage.from("product-images").remove([storage_path]);
    return json(req, { error: error.message }, 400);
  }

  const payload = await loadProduct(service, product_id);
  return json(req, { ...payload, image: data });
}

async function setPrimaryImage(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: image } = await service.from("product_images").select("*").eq("id", id).maybeSingle();
  if (!image) return json(req, { error: "not_found" }, 404);

  const { error: clearError } = await service
    .from("product_images")
    .update({ is_primary: false })
    .eq("product_id", image.product_id)
    .eq("is_primary", true);
  if (clearError) return json(req, { error: clearError.message }, 400);

  const { error } = await service.from("product_images").update({ is_primary: true }).eq("id", id);
  if (error) return json(req, { error: error.message }, 400);
  const payload = await loadProduct(service, image.product_id as string);
  return json(req, payload);
}

async function deleteImage(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: image } = await service.from("product_images").select("*").eq("id", id).maybeSingle();
  if (!image) return json(req, { error: "not_found" }, 404);

  const { error: storageError } = await service.storage.from("product-images").remove([image.storage_path]);
  if (storageError) return json(req, { error: "storage_delete_failed" }, 500);

  const { error } = await service.from("product_images").delete().eq("id", id);
  if (error) return json(req, { error: error.message }, 400);
  const payload = await loadProduct(service, image.product_id as string);
  return json(req, payload);
}
