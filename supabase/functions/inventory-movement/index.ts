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

const TYPES = new Set(["HQ", "EVENT", "TEMP", "THIRD_PARTY"]);
const REMAINDERS = new Set(["ZERO", "VERY_LOW", "HALF", "HIGH", "FULL"]);
const MIDPOINT: Record<string, number> = { ZERO: 0, VERY_LOW: 2, HALF: 5, HIGH: 8, FULL: 10 };

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

    if (action === "list-locations") return await listLocations(req, service, callerId, isAdmin);
    if (action === "create-location") return await requireAdmin(req, isAdmin, () => createLocation(req, service, callerId, body));
    if (action === "update-location") return await requireAdmin(req, isAdmin, () => updateLocation(req, service, body));
    if (action === "get-location-stock") return await getLocationStock(req, service, callerId, isAdmin, body);
    if (action === "search-skus") return await requireAdmin(req, isAdmin, () => searchSkus(req, service, body));
    if (action === "list-movements") return await listMovements(req, service, callerId, isAdmin, body);
    if (action === "get-movement") return await getMovement(req, service, callerId, isAdmin, body);
    if (action === "create-movement") return await requireAdmin(req, isAdmin, () => createMovement(req, service, callerId, body));
    if (action === "update-draft") return await requireAdmin(req, isAdmin, () => updateDraft(req, service, body));
    if (action === "add-item") return await requireAdmin(req, isAdmin, () => addItem(req, service, body));
    if (action === "remove-item") return await requireAdmin(req, isAdmin, () => removeItem(req, service, body));
    if (action === "dispatch") return await dispatchMovement(req, service, callerId, isAdmin, body);
    if (action === "receive") return await receiveMovement(req, service, callerId, isAdmin, body);
    if (action === "cancel-draft") return await requireAdmin(req, isAdmin, () => cancelDraft(req, service, callerId, body));
    if (action === "create-adjustment") return await requireAdmin(req, isAdmin, () => createAdjustment(req, service, callerId, body));
    if (action === "closing-distribution-preview") return await requireAdmin(req, isAdmin, () => closingPreview(req, service, body));
    if (action === "create-closing-distribution") return await requireAdmin(req, isAdmin, () => createClosing(req, service, callerId, body));
    return json(req, { error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "server_error";
    const mapped = mapError(message);
    return json(req, { error: mapped.error }, mapped.status);
  }
});

function mapError(message: string) {
  const keys = [
    "already_dispatched",
    "already_received",
    "not_draft",
    "not_dispatched",
    "not_cancellable",
    "movement_immutable",
    "insufficient_stock",
    "sku_not_in_assortment",
    "same_location",
    "hq_exists",
    "duplicate_sku",
    "empty_movement",
    "unchecked_receive",
    "not_closing",
    "not_found",
    "conflict",
    "invalid_units",
    "invalid_reason",
    "invalid_remainder",
    "invalid_pack_count",
    "invalid_type",
  ];
  for (const key of keys) {
    if (message.includes(key)) {
      const status = ["already_dispatched", "already_received", "conflict", "hq_exists", "duplicate_sku"].includes(key)
        ? 409
        : key === "not_found"
        ? 404
        : 400;
      return { error: key, status };
    }
  }
  if (/duplicate key|unique/i.test(message) && /inventory_locations_one_hq/i.test(message)) {
    return { error: "hq_exists", status: 409 };
  }
  if (/duplicate key|unique/i.test(message) && /inventory_movement_items_sku/i.test(message)) {
    return { error: "duplicate_sku", status: 409 };
  }
  if (message.includes("forbidden")) return { error: "forbidden", status: 403 };
  return { error: message, status: 500 };
}

function text(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function estimate(pack: number, full: number, remainder: string) {
  return full * pack + (MIDPOINT[remainder] ?? 0);
}

function unitsToPacks(units: number, pack: number) {
  const safePack = pack > 0 ? pack : 10;
  const full = Math.floor(Math.max(0, units) / safePack);
  const leftover = Math.max(0, units) % safePack;
  const codes: Array<[string, number]> = [
    ["FULL", 10],
    ["HIGH", 8],
    ["HALF", 5],
    ["VERY_LOW", 2],
    ["ZERO", 0],
  ];
  for (const [code, mid] of codes) {
    if (mid <= leftover) return { full, remainder: code, estimated: full * safePack + mid };
  }
  return { full, remainder: "ZERO", estimated: full * safePack };
}

async function requireAdmin(req: Request, isAdmin: boolean, fn: () => Promise<Response>) {
  if (!isAdmin) return json(req, { error: "forbidden" }, 403);
  return await fn();
}

async function assignedEventIds(service: ReturnType<typeof secretClient>, callerId: string) {
  const { data } = await service.from("event_members").select("event_id").eq("profile_id", callerId);
  return new Set((data ?? []).map((row) => row.event_id as string));
}

async function canAccessLocation(
  service: ReturnType<typeof secretClient>,
  locationId: string,
  callerId: string,
  isAdmin: boolean,
) {
  if (isAdmin) return true;
  const { data } = await service.from("inventory_locations").select("id, location_type, event_id").eq("id", locationId).maybeSingle();
  if (!data || data.location_type !== "EVENT" || !data.event_id) return false;
  const { data: member } = await service
    .from("event_members")
    .select("id")
    .eq("event_id", data.event_id)
    .eq("profile_id", callerId)
    .maybeSingle();
  return Boolean(member);
}

async function loadLocation(service: ReturnType<typeof secretClient>, id: string) {
  const { data } = await service.from("inventory_locations").select("*").eq("id", id).maybeSingle();
  return data;
}

async function attachSkus(service: ReturnType<typeof secretClient>, variantIds: string[]) {
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (!ids.length) return new Map<string, Record<string, unknown>>();
  const { data: variants } = await service
    .from("product_variants")
    .select("id, sku_code, product_id, size_id, primary_color_id")
    .in("id", ids);
  const productIds = [...new Set((variants ?? []).map((row) => row.product_id as string))];
  const sizeIds = [...new Set((variants ?? []).map((row) => row.size_id as string).filter(Boolean))];
  const colorIds = [...new Set((variants ?? []).map((row) => row.primary_color_id as string).filter(Boolean))];
  const [{ data: products }, { data: sizes }, { data: colors }] = await Promise.all([
    productIds.length
      ? service.from("products").select("id, name, product_code, primary_category_id, default_pack_quantity").in("id", productIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    sizeIds.length ? service.from("sizes").select("id, display_name").in("id", sizeIds) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    colorIds.length ? service.from("colors").select("id, name").in("id", colorIds) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);
  const catIds = [...new Set((products ?? []).map((row) => row.primary_category_id as string).filter(Boolean))];
  const { data: cats } = catIds.length
    ? await service.from("product_categories").select("id, name").in("id", catIds)
    : { data: [] as Array<Record<string, unknown>> };
  const productMap = new Map((products ?? []).map((row) => [row.id as string, row]));
  const sizeMap = new Map((sizes ?? []).map((row) => [row.id as string, row]));
  const colorMap = new Map((colors ?? []).map((row) => [row.id as string, row]));
  const catMap = new Map((cats ?? []).map((row) => [row.id as string, row]));
  const out = new Map<string, Record<string, unknown>>();
  for (const row of variants ?? []) {
    const product = productMap.get(row.product_id as string);
    const cat = product ? catMap.get(product.primary_category_id as string) : null;
    out.set(row.id as string, {
      product_name: product?.name ?? "",
      product_code: product?.product_code ?? "",
      sku_code: row.sku_code,
      size_name: sizeMap.get(row.size_id as string)?.display_name ?? null,
      color_name: colorMap.get(row.primary_color_id as string)?.name ?? null,
      category_name: cat?.name ?? null,
      pack_size: Number(product?.default_pack_quantity ?? 10),
    });
  }
  return out;
}

function withSku(row: Record<string, unknown>, sku: Record<string, unknown> | undefined) {
  return { ...row, ...(sku ?? {}) };
}

async function listLocations(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
) {
  const { data, error } = await service.from("inventory_locations").select("*").order("location_type").order("name");
  if (error) return json(req, { error: error.message }, 400);
  if (isAdmin) return json(req, { locations: data ?? [] });
  const events = await assignedEventIds(service, callerId);
  const locations = (data ?? []).filter((row) => row.location_type === "EVENT" && events.has(row.event_id as string));
  return json(req, { locations });
}

async function createLocation(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const location_type = text(body.location_type);
  const name = text(body.name);
  if (!TYPES.has(location_type) || location_type === "EVENT" || !name) return json(req, { error: "invalid_input" }, 400);
  const { data, error } = await service
    .from("inventory_locations")
    .insert({
      location_type,
      name,
      address: text(body.address) || null,
      address_detail: text(body.address_detail) || null,
      contact_name: text(body.contact_name) || null,
      contact_phone: text(body.contact_phone) || null,
      memo: text(body.memo) || null,
      created_by: callerId,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    const mapped = mapError(error.message);
    return json(req, { error: mapped.error }, mapped.status);
  }
  return json(req, { location: data });
}

async function updateLocation(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const current = await loadLocation(service, id);
  if (!current) return json(req, { error: "not_found" }, 404);
  if (current.location_type === "EVENT" && ("event_id" in body || "location_type" in body)) {
    return json(req, { error: "event_location_locked" }, 400);
  }
  const patch: Record<string, unknown> = {};
  if ("name" in body) patch.name = text(body.name);
  if ("address" in body) patch.address = text(body.address) || null;
  if ("address_detail" in body) patch.address_detail = text(body.address_detail) || null;
  if ("contact_name" in body) patch.contact_name = text(body.contact_name) || null;
  if ("contact_phone" in body) patch.contact_phone = text(body.contact_phone) || null;
  if ("memo" in body) patch.memo = text(body.memo) || null;
  if ("is_active" in body) patch.is_active = Boolean(body.is_active);
  const { data, error } = await service.from("inventory_locations").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { location: data });
}

async function getLocationStock(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  if (!(await canAccessLocation(service, id, callerId, isAdmin))) return json(req, { error: "forbidden" }, 403);
  const location = await loadLocation(service, id);
  if (!location) return json(req, { error: "not_found" }, 404);
  const { data: positions } = await service.from("inventory_positions").select("*").eq("location_id", id).order("updated_at", { ascending: false });
  const skus = await attachSkus(service, (positions ?? []).map((row) => row.product_variant_id as string));
  const rows = (positions ?? []).map((row) => withSku(row as Record<string, unknown>, skus.get(row.product_variant_id as string)));
  const { data: adjustments } = isAdmin
    ? await service.from("inventory_adjustments").select("*").eq("location_id", id).order("created_at", { ascending: false }).limit(50)
    : { data: [] as Array<Record<string, unknown>> };
  return json(req, { location, stock: rows, adjustments: adjustments ?? [] });
}

async function searchSkus(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const q = text(body.q).toLowerCase();
  const { data: products } = await service.from("products").select("id, name, product_code, default_pack_quantity, primary_category_id").limit(200);
  const { data: variants } = await service.from("product_variants").select("id, sku_code, product_id, size_id, primary_color_id").limit(400);
  const skus = await attachSkus(service, (variants ?? []).map((row) => row.id as string));
  const list = (variants ?? [])
    .map((row) => withSku({ product_variant_id: row.id }, skus.get(row.id as string)))
    .filter((row) => {
      if (!q) return true;
      return (
        String(row.product_name).toLowerCase().includes(q) ||
        String(row.product_code).toLowerCase().includes(q) ||
        String(row.sku_code).toLowerCase().includes(q)
      );
    })
    .slice(0, 50);
  return json(req, { skus: list, products: products ?? [] });
}

async function listMovements(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const { data, error } = await service.from("inventory_movements").select("*").order("created_at", { ascending: false });
  if (error) return json(req, { error: error.message }, 400);
  const { data: locations } = await service.from("inventory_locations").select("id, name, location_type, event_id");
  const locMap = new Map((locations ?? []).map((row) => [row.id as string, row]));
  let rows = (data ?? []).map((row) => ({
    ...row,
    source: locMap.get(row.source_location_id as string) ?? null,
    destination: locMap.get(row.destination_location_id as string) ?? null,
  }));
  if (!isAdmin) {
    const events = await assignedEventIds(service, callerId);
    rows = rows.filter((row) => {
      const source = row.source as { location_type?: string; event_id?: string } | null;
      const dest = row.destination as { location_type?: string; event_id?: string } | null;
      return (
        (source?.location_type === "EVENT" && events.has(source.event_id ?? "")) ||
        (dest?.location_type === "EVENT" && events.has(dest.event_id ?? ""))
      );
    });
  }
  const eventId = text(body.event_id);
  if (eventId) {
    rows = rows.filter((row) => {
      const source = row.source as { event_id?: string } | null;
      const dest = row.destination as { event_id?: string } | null;
      return source?.event_id === eventId || dest?.event_id === eventId;
    });
  }
  return json(req, { movements: rows });
}

async function loadMovement(service: ReturnType<typeof secretClient>, id: string) {
  const { data: movement } = await service.from("inventory_movements").select("*").eq("id", id).maybeSingle();
  if (!movement) return null;
  const { data: items } = await service.from("inventory_movement_items").select("*").eq("inventory_movement_id", id).order("created_at");
  const [source, destination] = await Promise.all([
    loadLocation(service, movement.source_location_id as string),
    loadLocation(service, movement.destination_location_id as string),
  ]);
  const skus = await attachSkus(service, (items ?? []).map((row) => row.product_variant_id as string));
  const decorated = (items ?? []).map((row) => {
    const sent = Number(row.sent_estimated_units);
    const received = row.received_estimated_units == null ? null : Number(row.received_estimated_units);
    return {
      ...withSku(row as Record<string, unknown>, skus.get(row.product_variant_id as string)),
      qty_delta: received == null ? null : received - sent,
    };
  });
  return { movement, source, destination, items: decorated };
}

async function canReadMovement(
  service: ReturnType<typeof secretClient>,
  loaded: NonNullable<Awaited<ReturnType<typeof loadMovement>>>,
  callerId: string,
  isAdmin: boolean,
) {
  if (isAdmin) return true;
  const events = await assignedEventIds(service, callerId);
  const sourceEvent = loaded.source?.event_id as string | null;
  const destEvent = loaded.destination?.event_id as string | null;
  return (loaded.source?.location_type === "EVENT" && events.has(sourceEvent ?? "")) ||
    (loaded.destination?.location_type === "EVENT" && events.has(destEvent ?? ""));
}

async function getMovement(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const loaded = await loadMovement(service, id);
  if (!loaded) return json(req, { error: "not_found" }, 404);
  if (!(await canReadMovement(service, loaded, callerId, isAdmin))) return json(req, { error: "forbidden" }, 403);
  return json(req, loaded);
}

async function createMovement(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const source_location_id = text(body.source_location_id);
  const destination_location_id = text(body.destination_location_id);
  if (!source_location_id || !destination_location_id) return json(req, { error: "invalid_input" }, 400);
  if (source_location_id === destination_location_id) return json(req, { error: "same_location" }, 400);
  const [source, dest] = await Promise.all([loadLocation(service, source_location_id), loadLocation(service, destination_location_id)]);
  if (!source || !dest) return json(req, { error: "not_found" }, 404);
  const { data: movementNo, error: noError } = await service.rpc("next_inventory_movement_no");
  if (noError) return json(req, { error: noError.message }, 400);
  const { data, error } = await service
    .from("inventory_movements")
    .insert({
      movement_no: String(movementNo),
      source_location_id,
      destination_location_id,
      status: "DRAFT",
      source_event_inventory_check_id: text(body.source_event_inventory_check_id) || null,
      memo: text(body.memo) || null,
      created_by: callerId,
    })
    .select("*")
    .maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { movement: data, source, destination: dest, items: [] });
}

async function updateDraft(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: current } = await service.from("inventory_movements").select("*").eq("id", id).maybeSingle();
  if (!current) return json(req, { error: "not_found" }, 404);
  if (current.status !== "DRAFT") return json(req, { error: "not_draft" }, 400);
  const patch: Record<string, unknown> = {};
  if ("memo" in body) patch.memo = text(body.memo) || null;
  if (body.source_location_id) patch.source_location_id = text(body.source_location_id);
  if (body.destination_location_id) patch.destination_location_id = text(body.destination_location_id);
  if (patch.source_location_id && patch.source_location_id === (patch.destination_location_id || current.destination_location_id)) {
    return json(req, { error: "same_location" }, 400);
  }
  if (patch.destination_location_id && (patch.source_location_id || current.source_location_id) === patch.destination_location_id) {
    return json(req, { error: "same_location" }, 400);
  }
  const { error } = await service.from("inventory_movements").update(patch).eq("id", id).eq("status", "DRAFT");
  if (error) return json(req, { error: error.message }, 400);
  const loaded = await loadMovement(service, id);
  return json(req, loaded);
}

async function destAssortmentOk(
  service: ReturnType<typeof secretClient>,
  dest: Record<string, unknown>,
  variantId: string,
) {
  if (dest.location_type !== "EVENT") return true;
  const { data } = await service
    .from("event_assortment_items")
    .select("id")
    .eq("event_id", dest.event_id as string)
    .eq("product_variant_id", variantId)
    .is("removed_at", null)
    .maybeSingle();
  return Boolean(data);
}

async function addItem(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const inventory_movement_id = text(body.inventory_movement_id);
  const product_variant_id = text(body.product_variant_id);
  if (!inventory_movement_id || !product_variant_id) return json(req, { error: "invalid_input" }, 400);
  const { data: movement } = await service.from("inventory_movements").select("*").eq("id", inventory_movement_id).maybeSingle();
  if (!movement) return json(req, { error: "not_found" }, 404);
  if (movement.status !== "DRAFT") return json(req, { error: "not_draft" }, 400);
  const dest = await loadLocation(service, movement.destination_location_id as string);
  if (!dest) return json(req, { error: "not_found" }, 404);
  if (!(await destAssortmentOk(service, dest, product_variant_id))) {
    return json(req, { error: "sku_not_in_assortment" }, 400);
  }
  const full_pack_count = Number(body.sent_full_pack_count);
  const remainder = text(body.sent_remainder_level);
  if (!Number.isInteger(full_pack_count) || full_pack_count < 0) return json(req, { error: "invalid_pack_count" }, 400);
  if (!REMAINDERS.has(remainder)) return json(req, { error: "invalid_remainder" }, 400);
  const skus = await attachSkus(service, [product_variant_id]);
  const pack = Number(skus.get(product_variant_id)?.pack_size ?? 10);
  const sent_estimated_units = estimate(pack, full_pack_count, remainder);
  const { data, error } = await service
    .from("inventory_movement_items")
    .insert({
      inventory_movement_id,
      product_variant_id,
      sent_full_pack_count: full_pack_count,
      sent_remainder_level: remainder,
      sent_estimated_units,
      memo: text(body.memo) || null,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    const mapped = mapError(error.message);
    return json(req, { error: mapped.error }, mapped.status);
  }
  return json(req, { item: data });
}

async function removeItem(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: item } = await service.from("inventory_movement_items").select("*").eq("id", id).maybeSingle();
  if (!item) return json(req, { error: "not_found" }, 404);
  const { data: movement } = await service.from("inventory_movements").select("status").eq("id", item.inventory_movement_id).maybeSingle();
  if (!movement || movement.status !== "DRAFT") return json(req, { error: "not_draft" }, 400);
  const { error } = await service.from("inventory_movement_items").delete().eq("id", id);
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { ok: true });
}

async function dispatchMovement(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const loaded = await loadMovement(service, id);
  if (!loaded) return json(req, { error: "not_found" }, 404);
  if (loaded.movement.status === "DISPATCHED" || loaded.movement.status === "RECEIVED") {
    return json(req, { error: "already_dispatched" }, 409);
  }
  if (!isAdmin) {
    if (loaded.source?.location_type !== "EVENT") return json(req, { error: "forbidden" }, 403);
    if (!(await canAccessLocation(service, loaded.movement.source_location_id as string, callerId, false))) {
      return json(req, { error: "forbidden" }, 403);
    }
  }
  const { error } = await service.rpc("dispatch_inventory_movement", { p_movement_id: id, p_dispatched_by: callerId });
  if (error) {
    const mapped = mapError(error.message);
    return json(req, { error: mapped.error }, mapped.status);
  }
  return json(req, await loadMovement(service, id));
}

async function receiveMovement(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const loaded = await loadMovement(service, id);
  if (!loaded) return json(req, { error: "not_found" }, 404);
  if (loaded.movement.status === "RECEIVED") return json(req, { error: "already_received" }, 409);
  if (!isAdmin) {
    if (loaded.destination?.location_type !== "EVENT") return json(req, { error: "forbidden" }, 403);
    if (!(await canAccessLocation(service, loaded.movement.destination_location_id as string, callerId, false))) {
      return json(req, { error: "forbidden" }, 403);
    }
  }
  const incoming = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
  const byId = new Map(incoming.map((row) => [text(row.id), row]));
  const same = Boolean(body.same_as_sent);
  for (const item of loaded.items) {
    const patch = byId.get(item.id as string);
    let full = patch ? Number(patch.received_full_pack_count) : Number(item.received_full_pack_count);
    let remainder = patch ? text(patch.received_remainder_level) : text(item.received_remainder_level);
    if (same || item.received_estimated_units == null) {
      if (same || !patch) {
        full = Number(item.sent_full_pack_count);
        remainder = text(item.sent_remainder_level);
      }
    }
    if (patch && !same) {
      full = Number(patch.received_full_pack_count);
      remainder = text(patch.received_remainder_level);
    }
    if (!Number.isInteger(full) || full < 0) return json(req, { error: "invalid_pack_count" }, 400);
    if (!REMAINDERS.has(remainder)) return json(req, { error: "invalid_remainder" }, 400);
    const pack = Number(item.pack_size ?? 10);
    const received_estimated_units = estimate(pack, full, remainder);
    const { error } = await service
      .from("inventory_movement_items")
      .update({
        received_full_pack_count: full,
        received_remainder_level: remainder,
        received_estimated_units,
      })
      .eq("id", item.id)
      .eq("inventory_movement_id", id);
    if (error) return json(req, { error: error.message }, 400);
  }
  const { error } = await service.rpc("receive_inventory_movement", { p_movement_id: id, p_received_by: callerId });
  if (error) {
    const mapped = mapError(error.message);
    return json(req, { error: mapped.error }, mapped.status);
  }
  return json(req, await loadMovement(service, id));
}

async function cancelDraft(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: current } = await service.from("inventory_movements").select("*").eq("id", id).maybeSingle();
  if (!current) return json(req, { error: "not_found" }, 404);
  if (current.status === "DISPATCHED" || current.status === "RECEIVED") return json(req, { error: "not_cancellable" }, 400);
  if (current.status !== "DRAFT") return json(req, { error: "not_draft" }, 400);
  const { data, error } = await service
    .from("inventory_movements")
    .update({ status: "CANCELLED", cancelled_at: new Date().toISOString(), cancelled_by: callerId })
    .eq("id", id)
    .eq("status", "DRAFT")
    .select("*")
    .maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_draft" }, 400);
  return json(req, { movement: data });
}

async function createAdjustment(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const location_id = text(body.location_id);
  const product_variant_id = text(body.product_variant_id);
  const reason = text(body.reason);
  if (!location_id || !product_variant_id || !reason) return json(req, { error: "invalid_input" }, 400);
  let after = body.after_estimated_units;
  if (after == null) {
    const full = Number(body.full_pack_count);
    const remainder = text(body.remainder_level);
    if (!Number.isInteger(full) || full < 0) return json(req, { error: "invalid_pack_count" }, 400);
    if (!REMAINDERS.has(remainder)) return json(req, { error: "invalid_remainder" }, 400);
    const skus = await attachSkus(service, [product_variant_id]);
    after = estimate(Number(skus.get(product_variant_id)?.pack_size ?? 10), full, remainder);
  }
  const afterUnits = Number(after);
  if (!Number.isInteger(afterUnits) || afterUnits < 0) return json(req, { error: "invalid_units" }, 400);
  const { data, error } = await service.rpc("apply_inventory_adjustment", {
    p_location_id: location_id,
    p_product_variant_id: product_variant_id,
    p_after_units: afterUnits,
    p_reason: reason,
    p_memo: text(body.memo) || null,
    p_created_by: callerId,
  });
  if (error) {
    const mapped = mapError(error.message);
    return json(req, { error: mapped.error }, mapped.status);
  }
  return json(req, { adjustment: data });
}

async function reservedBySource(service: ReturnType<typeof secretClient>, sourceId: string) {
  const { data: drafts } = await service
    .from("inventory_movements")
    .select("id")
    .eq("source_location_id", sourceId)
    .eq("status", "DRAFT");
  const ids = (drafts ?? []).map((row) => row.id as string);
  if (!ids.length) return new Map<string, number>();
  const { data: items } = await service
    .from("inventory_movement_items")
    .select("product_variant_id, sent_estimated_units, inventory_movement_id")
    .in("inventory_movement_id", ids);
  const map = new Map<string, number>();
  for (const row of items ?? []) {
    const key = row.product_variant_id as string;
    map.set(key, (map.get(key) ?? 0) + Number(row.sent_estimated_units));
  }
  return map;
}

async function closingPreview(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const checkId = text(body.check_id);
  if (!checkId) return json(req, { error: "invalid_input" }, 400);
  const { data: check } = await service.from("event_inventory_checks").select("*").eq("id", checkId).maybeSingle();
  if (!check || check.status !== "CONFIRMED" || check.check_kind !== "CLOSING") {
    return json(req, { error: "not_closing" }, 400);
  }
  const { data: location } = await service
    .from("inventory_locations")
    .select("*")
    .eq("event_id", check.event_id)
    .eq("location_type", "EVENT")
    .maybeSingle();
  if (!location) return json(req, { error: "not_found" }, 404);
  const { data: positions } = await service.from("inventory_positions").select("*").eq("location_id", location.id);
  const reserved = await reservedBySource(service, location.id as string);
  const { data: assortment } = await service.from("event_assortment_items").select("*").eq("event_id", check.event_id);
  const snap = new Map((assortment ?? []).map((row) => [row.product_variant_id as string, row]));
  const skus = await attachSkus(service, (positions ?? []).map((row) => row.product_variant_id as string));
  const lines = (positions ?? []).map((row) => {
    const variantId = row.product_variant_id as string;
    const pack = Number(skus.get(variantId)?.pack_size ?? 10);
    const position_units = Number(row.estimated_units);
    const reserved_units = reserved.get(variantId) ?? 0;
    const available_units = Math.max(0, position_units - reserved_units);
    const packs = unitsToPacks(available_units, pack);
    const shot = snap.get(variantId);
    return {
      product_variant_id: variantId,
      product_name: shot?.product_name_snapshot ?? skus.get(variantId)?.product_name,
      sku_code: shot?.sku_code_snapshot ?? skus.get(variantId)?.sku_code,
      size_name: shot?.size_snapshot ?? skus.get(variantId)?.size_name,
      color_name: shot?.color_snapshot ?? skus.get(variantId)?.color_name,
      category_name: shot?.category_snapshot ?? skus.get(variantId)?.category_name ?? "미분류",
      position_units,
      reserved_units,
      available_units,
      ...packs,
    };
  });
  return json(req, { check, location, lines });
}

async function createClosing(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const preview = await closingPreview(req, service, body);
  const parsed = await preview.json() as {
    error?: string;
    check?: { id: string };
    lines?: Array<Record<string, unknown>>;
  };
  if (!preview.ok) return json(req, { error: parsed.error || "not_closing" }, preview.status);
  const destinations = (body.destinations ?? {}) as Record<string, string>;
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const line of parsed.lines ?? []) {
    if (Number(line.available_units) <= 0) continue;
    const dest = destinations[String(line.category_name || "미분류")];
    if (!dest) continue;
    const list = groups.get(dest) ?? [];
    list.push({
      product_variant_id: line.product_variant_id,
      sent_full_pack_count: line.full,
      sent_remainder_level: line.remainder,
      sent_estimated_units: line.estimated,
    });
    groups.set(dest, list);
  }
  if (!groups.size) return json(req, { error: "empty_movement" }, 400);
  const payload = [...groups.entries()].map(([destination_location_id, items]) => ({ destination_location_id, items }));
  const { data, error } = await service.rpc("create_closing_movements", {
    p_check_id: parsed.check?.id,
    p_created_by: callerId,
    p_groups: payload,
  });
  if (error) {
    const mapped = mapError(error.message);
    return json(req, { error: mapped.error }, mapped.status);
  }
  return json(req, data);
}
