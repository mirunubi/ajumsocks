import { json, preflight } from "../_shared/http.ts";
import { hasAppAccess } from "../_shared/crypto.ts";
import { callerUserId, secretClient } from "../_shared/supabase.ts";

type AppRole = "ADMIN" | "STAFF" | "PART_TIMER";
type ItemType = "EQUIPMENT" | "CONSUMABLE";
type PrepStatus = "NOT_READY" | "READY" | "ON_SITE" | "RETURNED";
type Profile = {
  id: string;
  role: AppRole;
  is_active: boolean;
  login_allowed_from: string | null;
  login_allowed_until: string | null;
};

const TYPES = new Set<ItemType>(["EQUIPMENT", "CONSUMABLE"]);
const STATUSES = new Set<PrepStatus>(["NOT_READY", "READY", "ON_SITE", "RETURNED"]);

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

    if (action === "get-event") return await getEventPrep(req, service, callerId, isAdmin, body);
    if (action === "set-status") return await setStatus(req, service, callerId, isAdmin, body);

    if (!isAdmin) return json(req, { error: "forbidden" }, 403);
    if (action === "list-items") return await listItems(req, service);
    if (action === "upsert-item") return await upsertItem(req, service, callerId, body);
    if (action === "list-sets") return await listSets(req, service);
    if (action === "upsert-set") return await upsertSet(req, service, callerId, body);
    if (action === "add-set-item") return await addSetItem(req, service, body);
    if (action === "update-set-item") return await updateSetItem(req, service, body);
    if (action === "remove-set-item") return await removeSetItem(req, service, body);
    if (action === "preview-apply") return await previewApply(req, service, body);
    if (action === "apply-set") return await applySet(req, service, callerId, body);
    if (action === "update-event-item") return await updateEventItem(req, service, callerId, body);
    if (action === "add-event-item") return await addEventItem(req, service, callerId, body);
    if (action === "remove-event-item") return await removeEventItem(req, service, callerId, body);
    return json(req, { error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "server_error";
    return json(req, { error: message }, 500);
  }
});

function text(value: unknown) {
  return String(value ?? "").trim();
}

function qty(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

async function canRead(
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

function defaultReturn(itemType: ItemType, override: unknown) {
  if (typeof override === "boolean") return override;
  return itemType === "EQUIPMENT";
}

async function listItems(req: Request, service: ReturnType<typeof secretClient>) {
  const { data, error } = await service
    .from("preparation_items")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return json(req, { items: data ?? [] });
}

async function upsertItem(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const name = text(body.name);
  const item_type = body.item_type as ItemType;
  const default_unit = text(body.default_unit) || "개";
  if (!name || !TYPES.has(item_type)) return json(req, { error: "invalid_input" }, 400);
  const row = {
    name,
    item_type,
    default_unit,
    requires_return: defaultReturn(item_type, body.requires_return),
    memo: text(body.memo) || null,
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
  };
  if (body.id) {
    const { data, error } = await service.from("preparation_items").update(row).eq("id", text(body.id)).select("*").maybeSingle();
    if (error) return json(req, { error: error.message }, 400);
    if (!data) return json(req, { error: "not_found" }, 404);
    return json(req, { item: data });
  }
  const { data, error } = await service.from("preparation_items").insert({ ...row, created_by: callerId }).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { item: data });
}

async function listSets(req: Request, service: ReturnType<typeof secretClient>) {
  const [{ data: sets, error: sErr }, { data: lines, error: lErr }] = await Promise.all([
    service.from("preparation_sets").select("*").order("name"),
    service.from("preparation_set_items").select("*").order("sort_order"),
  ]);
  if (sErr) throw sErr;
  if (lErr) throw lErr;
  return json(req, { sets: sets ?? [], set_items: lines ?? [] });
}

async function upsertSet(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const name = text(body.name);
  if (!name) return json(req, { error: "invalid_input" }, 400);
  const row = {
    name,
    description: text(body.description) || null,
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
  };
  if (body.id) {
    const { data, error } = await service.from("preparation_sets").update(row).eq("id", text(body.id)).select("*").maybeSingle();
    if (error) return json(req, { error: error.message }, 400);
    if (!data) return json(req, { error: "not_found" }, 404);
    return json(req, { set: data });
  }
  const { data, error } = await service.from("preparation_sets").insert({ ...row, created_by: callerId }).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { set: data });
}

async function addSetItem(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const preparation_set_id = text(body.preparation_set_id);
  const preparation_item_id = text(body.preparation_item_id);
  const planned_quantity = qty(body.planned_quantity);
  if (!preparation_set_id || !preparation_item_id || planned_quantity < 1) {
    return json(req, { error: planned_quantity < 1 ? "invalid_quantity" : "invalid_input" }, 400);
  }
  const { data, error } = await service
    .from("preparation_set_items")
    .insert({
      preparation_set_id,
      preparation_item_id,
      planned_quantity,
      sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
      memo: text(body.memo) || null,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return json(req, { error: "duplicate_item" }, 409);
    return json(req, { error: error.message }, 400);
  }
  return json(req, { set_item: data });
}

async function updateSetItem(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const patch: Record<string, unknown> = {};
  if ("planned_quantity" in body) {
    const planned_quantity = qty(body.planned_quantity);
    if (planned_quantity < 1) return json(req, { error: "invalid_quantity" }, 400);
    patch.planned_quantity = planned_quantity;
  }
  if ("memo" in body) patch.memo = text(body.memo) || null;
  if ("sort_order" in body) patch.sort_order = Number(body.sort_order);
  const { data, error } = await service.from("preparation_set_items").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_found" }, 404);
  return json(req, { set_item: data });
}

async function removeSetItem(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { error } = await service.from("preparation_set_items").delete().eq("id", id);
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { ok: true });
}

async function loadSetLines(service: ReturnType<typeof secretClient>, setId: string) {
  const { data: set } = await service.from("preparation_sets").select("*").eq("id", setId).maybeSingle();
  if (!set) return null;
  const { data: lines } = await service
    .from("preparation_set_items")
    .select("*")
    .eq("preparation_set_id", setId)
    .order("sort_order");
  const ids = [...new Set((lines ?? []).map((row) => row.preparation_item_id))];
  const { data: items } = ids.length
    ? await service.from("preparation_items").select("*").in("id", ids)
    : { data: [] as Array<Record<string, unknown>> };
  const map = new Map((items ?? []).map((row) => [row.id, row]));
  return {
    set,
    lines: (lines ?? []).map((line) => ({
      ...line,
      item: map.get(line.preparation_item_id) ?? null,
    })),
  };
}

async function previewApply(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const loaded = await loadSetLines(service, text(body.preparation_set_id));
  if (!loaded) return json(req, { error: "not_found" }, 404);
  return json(req, loaded);
}

async function applySet(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const preparation_set_id = text(body.preparation_set_id);
  if (!event_id || !preparation_set_id) return json(req, { error: "invalid_input" }, 400);

  const { data: event } = await service.from("events").select("id").eq("id", event_id).maybeSingle();
  if (!event) return json(req, { error: "not_found" }, 404);

  const { data: existing } = await service.from("event_preparation_plans").select("id").eq("event_id", event_id).maybeSingle();
  if (existing) return json(req, { error: "plan_exists" }, 409);

  const loaded = await loadSetLines(service, preparation_set_id);
  if (!loaded) return json(req, { error: "not_found" }, 404);
  if (loaded.lines.length === 0) return json(req, { error: "empty_set" }, 400);

  const { data: plan, error: planError } = await service
    .from("event_preparation_plans")
    .insert({
      event_id,
      source_preparation_set_id: preparation_set_id,
      applied_by: callerId,
    })
    .select("*")
    .maybeSingle();
  if (planError) return json(req, { error: planError.message }, 400);

  const rows = loaded.lines.map((line, index) => {
    const item = line.item as {
      id: string;
      name: string;
      item_type: ItemType;
      default_unit: string;
      requires_return: boolean;
    } | null;
    return {
      plan_id: plan.id,
      event_id,
      source_preparation_item_id: line.preparation_item_id,
      item_name_snapshot: item?.name ?? "삭제된 항목",
      item_type_snapshot: item?.item_type ?? "EQUIPMENT",
      unit_snapshot: item?.default_unit ?? "개",
      planned_quantity: line.planned_quantity,
      requires_return: item?.requires_return ?? true,
      status: "NOT_READY",
      memo: line.memo,
      sort_order: line.sort_order ?? index,
      updated_by: callerId,
    };
  });

  const { data: items, error: itemError } = await service.from("event_preparation_items").insert(rows).select("*");
  if (itemError) {
    await service.from("event_preparation_plans").delete().eq("id", plan.id);
    return json(req, { error: itemError.message }, 400);
  }
  return json(req, { plan, items: items ?? [] });
}

async function eventRows(service: ReturnType<typeof secretClient>, eventId: string) {
  const [{ data: plan }, { data: items }] = await Promise.all([
    service.from("event_preparation_plans").select("*").eq("event_id", eventId).maybeSingle(),
    service.from("event_preparation_items").select("*").eq("event_id", eventId).order("sort_order").order("created_at"),
  ]);
  return { plan, items: items ?? [] };
}

async function getEventPrep(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  if (!event_id) return json(req, { error: "invalid_input" }, 400);
  if (!(await canRead(service, event_id, callerId, isAdmin))) return json(req, { error: "not_found" }, 404);
  const payload = await eventRows(service, event_id);
  return json(req, payload);
}

async function updateEventItem(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const patch: Record<string, unknown> = { updated_by: callerId };
  if ("planned_quantity" in body) {
    const planned_quantity = qty(body.planned_quantity);
    if (planned_quantity < 1) return json(req, { error: "invalid_quantity" }, 400);
    patch.planned_quantity = planned_quantity;
  }
  if ("memo" in body) patch.memo = text(body.memo) || null;
  const { data, error } = await service.from("event_preparation_items").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_found" }, 404);
  return json(req, { item: data });
}

async function addEventItem(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const preparation_item_id = text(body.preparation_item_id);
  const planned_quantity = qty(body.planned_quantity);
  if (!event_id || !preparation_item_id || planned_quantity < 1) {
    return json(req, { error: planned_quantity < 1 ? "invalid_quantity" : "invalid_input" }, 400);
  }
  const { data: plan } = await service.from("event_preparation_plans").select("*").eq("event_id", event_id).maybeSingle();
  if (!plan) return json(req, { error: "no_plan" }, 400);
  const { data: master } = await service.from("preparation_items").select("*").eq("id", preparation_item_id).maybeSingle();
  if (!master) return json(req, { error: "not_found" }, 404);

  const { data: removed } = await service
    .from("event_preparation_items")
    .select("*")
    .eq("event_id", event_id)
    .eq("source_preparation_item_id", preparation_item_id)
    .not("removed_at", "is", null)
    .maybeSingle();
  if (removed) {
    const { data, error } = await service
      .from("event_preparation_items")
      .update({
        removed_at: null,
        planned_quantity,
        memo: text(body.memo) || removed.memo,
        updated_by: callerId,
        status: "NOT_READY",
      })
      .eq("id", removed.id)
      .select("*")
      .maybeSingle();
    if (error) return json(req, { error: error.message }, 400);
    return json(req, { item: data });
  }

  const { data, error } = await service
    .from("event_preparation_items")
    .insert({
      plan_id: plan.id,
      event_id,
      source_preparation_item_id: preparation_item_id,
      item_name_snapshot: master.name,
      item_type_snapshot: master.item_type,
      unit_snapshot: master.default_unit,
      planned_quantity,
      requires_return: master.requires_return,
      status: "NOT_READY",
      memo: text(body.memo) || null,
      sort_order: 900,
      updated_by: callerId,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return json(req, { error: "duplicate_item" }, 409);
    return json(req, { error: error.message }, 400);
  }
  return json(req, { item: data });
}

async function removeEventItem(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data, error } = await service
    .from("event_preparation_items")
    .update({ removed_at: new Date().toISOString(), updated_by: callerId })
    .eq("id", id)
    .is("removed_at", null)
    .select("*")
    .maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_found" }, 404);
  return json(req, { item: data });
}

async function setStatus(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  const status = body.status as PrepStatus;
  if (!id || !STATUSES.has(status)) return json(req, { error: "invalid_input" }, 400);
  const { data: row } = await service.from("event_preparation_items").select("*").eq("id", id).maybeSingle();
  if (!row || row.removed_at) return json(req, { error: "not_found" }, 404);
  if (!(await canRead(service, row.event_id, callerId, isAdmin))) return json(req, { error: "forbidden" }, 403);
  if (!row.requires_return && status === "RETURNED") return json(req, { error: "return_not_required" }, 400);

  const { data, error } = await service
    .from("event_preparation_items")
    .update({ status, updated_by: callerId })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { item: data });
}
