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

const KINDS = new Set(["OPENING", "ROUTINE", "CLOSING"]);
const SCOPES = new Set(["FULL", "PARTIAL"]);
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

    if (action === "get-current") return await getCurrent(req, service, callerId, isAdmin, body);
    if (action === "list-checks") return await listChecks(req, service, callerId, isAdmin, body);
    if (action === "get-check") return await getCheck(req, service, callerId, isAdmin, body);
    if (action === "create-check") return await createCheck(req, service, callerId, isAdmin, body);
    if (action === "save-item") return await saveItem(req, service, callerId, isAdmin, body);
    if (action === "confirm-check") return await confirmCheck(req, service, callerId, isAdmin, body);
    if (action === "cancel-check") return await cancelCheck(req, service, callerId, isAdmin, body);
    return json(req, { error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "server_error";
    const mapped = mapError(message);
    return json(req, { error: mapped.error }, mapped.status);
  }
});

function mapError(message: string) {
  const keys = [
    "already_confirmed",
    "not_draft",
    "incomplete_full_check",
    "empty_partial_check",
    "empty_targets",
    "invalid_kind",
    "invalid_scope",
    "not_found",
    "conflict",
    "sku_not_in_check",
    "unchecked_pair",
    "invalid_pack_count",
    "invalid_remainder",
    "confirmed_immutable",
  ];
  for (const key of keys) {
    if (message.includes(key)) {
      const status = key === "already_confirmed" || key === "conflict" ? 409 : key === "not_found" ? 404 : 400;
      return { error: key, status };
    }
  }
  if (message.includes("forbidden")) return { error: "forbidden", status: 403 };
  return { error: message, status: 500 };
}

function text(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function estimate(pack: number, full: number | null, remainder: string | null) {
  if (full == null || !remainder || !(remainder in MIDPOINT)) return null;
  return full * pack + MIDPOINT[remainder];
}

async function canAccess(
  service: ReturnType<typeof secretClient>,
  eventId: string,
  callerId: string,
  isAdmin: boolean,
) {
  if (isAdmin) return true;
  const { data } = await service
    .from("event_members")
    .select("id")
    .eq("event_id", eventId)
    .eq("profile_id", callerId)
    .maybeSingle();
  return Boolean(data);
}

async function requireEventAccess(
  req: Request,
  service: ReturnType<typeof secretClient>,
  eventId: string,
  callerId: string,
  isAdmin: boolean,
) {
  if (!eventId) return json(req, { error: "invalid_input" }, 400);
  if (!(await canAccess(service, eventId, callerId, isAdmin))) return json(req, { error: "forbidden" }, 403);
  return null;
}

async function loadCheck(service: ReturnType<typeof secretClient>, id: string) {
  const { data: check } = await service.from("event_inventory_checks").select("*").eq("id", id).maybeSingle();
  if (!check) return null;
  const { data: items } = await service
    .from("event_inventory_check_items")
    .select("*")
    .eq("inventory_check_id", id)
    .order("created_at");
  return { check, items: items ?? [] };
}

async function assortmentByVariant(service: ReturnType<typeof secretClient>, eventId: string) {
  const { data } = await service
    .from("event_assortment_items")
    .select("*")
    .eq("event_id", eventId);
  return new Map((data ?? []).map((row) => [row.product_variant_id as string, row]));
}

async function attachDisplay(
  service: ReturnType<typeof secretClient>,
  eventId: string,
  rows: Array<Record<string, unknown>>,
) {
  const assortment = await assortmentByVariant(service, eventId);
  const productIds = [...new Set([...assortment.values()].map((row) => row.product_id as string))];
  const { data: images } = productIds.length
    ? await service.from("product_images").select("product_id, storage_path, is_primary").in("product_id", productIds).eq("is_primary", true)
    : { data: [] as Array<{ product_id: string; storage_path: string }> };
  const imageByProduct = new Map((images ?? []).map((row) => [row.product_id as string, row.storage_path as string]));
  return await Promise.all(rows.map(async (row) => {
    const snap = assortment.get(row.product_variant_id as string);
    const path = snap ? imageByProduct.get(snap.product_id as string) : null;
    let image_url: string | null = null;
    if (path) {
      const { data } = await service.storage.from("product-images").createSignedUrl(path, 3600);
      image_url = data?.signedUrl ?? null;
    }
    const pack = Number(row.pack_size_snapshot ?? 10);
    const full = row.full_pack_count == null ? null : Number(row.full_pack_count);
    const remainder = (row.remainder_level as string | null) ?? null;
    return {
      ...row,
      product_name: snap?.product_name_snapshot ?? "",
      product_code: snap?.product_code_snapshot ?? "",
      sku_code: snap?.sku_code_snapshot ?? "",
      size_name: snap?.size_snapshot ?? null,
      color_name: snap?.color_snapshot ?? null,
      category_name: snap?.category_snapshot ?? null,
      image_url,
      estimated_qty: estimate(pack, full, remainder),
    };
  }));
}

async function getCurrent(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const denied = await requireEventAccess(req, service, event_id, callerId, isAdmin);
  if (denied) return denied;
  const [{ data: current }, { data: checks }] = await Promise.all([
    service.from("event_inventory_current").select("*").eq("event_id", event_id).order("updated_at", { ascending: false }),
    service.from("event_inventory_checks").select("*").eq("event_id", event_id).order("started_at", { ascending: false }),
  ]);
  const rows = await attachDisplay(service, event_id, (current ?? []) as Array<Record<string, unknown>>);
  return json(req, { current: rows, checks: checks ?? [] });
}

async function listChecks(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const denied = await requireEventAccess(req, service, event_id, callerId, isAdmin);
  if (denied) return denied;
  const { data, error } = await service
    .from("event_inventory_checks")
    .select("*")
    .eq("event_id", event_id)
    .order("started_at", { ascending: false });
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { checks: data ?? [] });
}

async function getCheck(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const loaded = await loadCheck(service, id);
  if (!loaded) return json(req, { error: "not_found" }, 404);
  const denied = await requireEventAccess(req, service, loaded.check.event_id as string, callerId, isAdmin);
  if (denied) return denied;
  const items = await attachDisplay(service, loaded.check.event_id as string, loaded.items as Array<Record<string, unknown>>);
  const { data: current } = await service.from("event_inventory_current").select("*").eq("event_id", loaded.check.event_id);
  const currentBySku = new Map((current ?? []).map((row) => [row.product_variant_id as string, row]));
  const withPrev = items.map((item) => {
    const prev = currentBySku.get(item.product_variant_id as string);
    const prevEst = prev
      ? estimate(Number(prev.pack_size_snapshot), Number(prev.full_pack_count), prev.remainder_level as string)
      : null;
    const curEst = item.estimated_qty as number | null;
    return {
      ...item,
      previous_full_pack_count: prev?.full_pack_count ?? null,
      previous_remainder_level: prev?.remainder_level ?? null,
      previous_estimated_qty: prevEst,
      delta_qty: curEst != null && prevEst != null ? curEst - prevEst : null,
    };
  });
  const unchecked = withPrev.filter((row) => row.full_pack_count == null).length;
  return json(req, { check: loaded.check, items: withPrev, unchecked });
}

async function createCheck(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const denied = await requireEventAccess(req, service, event_id, callerId, isAdmin);
  if (denied) return denied;
  const check_kind = text(body.check_kind);
  const check_scope = text(body.check_scope) || "FULL";
  if (!KINDS.has(check_kind) || !SCOPES.has(check_scope)) return json(req, { error: "invalid_input" }, 400);

  const { data, error } = await service.rpc("start_event_inventory_check", {
    p_event_id: event_id,
    p_check_kind: check_kind,
    p_check_scope: check_scope,
    p_started_by: callerId,
    p_memo: text(body.memo) || null,
  });
  if (error) {
    const mapped = mapError(error.message);
    return json(req, { error: mapped.error }, mapped.status);
  }
  const loaded = await loadCheck(service, String(data));
  return json(req, loaded);
}

async function saveItem(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: item } = await service.from("event_inventory_check_items").select("*").eq("id", id).maybeSingle();
  if (!item) return json(req, { error: "not_found" }, 404);
  const denied = await requireEventAccess(req, service, item.event_id as string, callerId, isAdmin);
  if (denied) return denied;

  const { data: check } = await service.from("event_inventory_checks").select("*").eq("id", item.inventory_check_id).maybeSingle();
  if (!check) return json(req, { error: "not_found" }, 404);
  if (check.status !== "DRAFT") return json(req, { error: "not_draft" }, 400);

  const expected = text(body.updated_at);
  if (expected && expected !== item.updated_at) return json(req, { error: "conflict" }, 409);

  const fullRaw = body.full_pack_count;
  const remainder = text(body.remainder_level);
  if (fullRaw === null || fullRaw === "" || remainder === "") {
    return json(req, { error: "unchecked_pair" }, 400);
  }
  const full_pack_count = Number(fullRaw);
  if (!Number.isInteger(full_pack_count) || full_pack_count < 0) return json(req, { error: "invalid_pack_count" }, 400);
  if (!REMAINDERS.has(remainder)) return json(req, { error: "invalid_remainder" }, 400);

  let query = service
    .from("event_inventory_check_items")
    .update({
      full_pack_count,
      remainder_level: remainder,
      checked_at: new Date().toISOString(),
      checked_by: callerId,
      memo: body.memo === undefined ? item.memo : (text(body.memo) || null),
    })
    .eq("id", id);
  if (expected) query = query.eq("updated_at", expected);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "conflict" }, 409);
  return json(req, { item: data });
}

async function confirmCheck(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: check } = await service.from("event_inventory_checks").select("*").eq("id", id).maybeSingle();
  if (!check) return json(req, { error: "not_found" }, 404);
  const denied = await requireEventAccess(req, service, check.event_id as string, callerId, isAdmin);
  if (denied) return denied;
  if (check.status === "CONFIRMED") return json(req, { error: "already_confirmed" }, 409);

  const { error } = await service.rpc("confirm_event_inventory_check", {
    p_check_id: id,
    p_confirmed_by: callerId,
  });
  if (error) {
    const mapped = mapError(error.message);
    return json(req, { error: mapped.error }, mapped.status);
  }
  const loaded = await loadCheck(service, id);
  return json(req, loaded);
}

async function cancelCheck(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: check } = await service.from("event_inventory_checks").select("*").eq("id", id).maybeSingle();
  if (!check) return json(req, { error: "not_found" }, 404);
  const denied = await requireEventAccess(req, service, check.event_id as string, callerId, isAdmin);
  if (denied) return denied;
  if (check.status === "CONFIRMED") return json(req, { error: "not_draft" }, 400);
  if (check.status !== "DRAFT") return json(req, { error: "not_draft" }, 400);

  const { data, error } = await service
    .from("event_inventory_checks")
    .update({ status: "CANCELLED" })
    .eq("id", id)
    .eq("status", "DRAFT")
    .select("*")
    .maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_draft" }, 400);
  return json(req, { check: data });
}
