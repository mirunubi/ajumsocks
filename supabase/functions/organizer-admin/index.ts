import { json, preflight } from "../_shared/http.ts";
import { hasAppAccess } from "../_shared/crypto.ts";
import { callerUserId, secretClient } from "../_shared/supabase.ts";

type AppRole = "ADMIN" | "STAFF" | "PART_TIMER";
type ContractType = "NONE" | "COMMISSION" | "FIXED_FEE" | "MIXED";
type ContactType = "VENUE" | "HQ" | "OTHER";

type Profile = {
  id: string;
  role: AppRole;
  is_active: boolean;
  login_allowed_from: string | null;
  login_allowed_until: string | null;
};

const CONTRACTS = new Set<ContractType>(["NONE", "COMMISSION", "FIXED_FEE", "MIXED"]);
const CONTACTS = new Set<ContactType>(["VENUE", "HQ", "OTHER"]);
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  try {
    const callerId = await callerUserId(req);
    if (!callerId) return json(req, { error: "unauthorized" }, 401);

    const service = secretClient();
    const { data: caller, error: callerError } = await service
      .from("profiles")
      .select("*")
      .eq("id", callerId)
      .maybeSingle();
    if (callerError) throw callerError;
    if (!caller || !hasAppAccess(caller as Profile)) {
      return json(req, { error: "forbidden" }, 403);
    }

    const body = (await req.json()) as Record<string, unknown>;
    const action = body?.action as string;
    const isAdmin = caller.role === "ADMIN";

    if (action === "list") return await requireAdmin(req, isAdmin, () => listOrganizers(req, service));
    if (action === "get") return await requireAdmin(req, isAdmin, () => getOrganizer(req, service, body));
    if (action === "create") return await requireAdmin(req, isAdmin, () => createOrganizer(req, service, callerId, body));
    if (action === "update") return await requireAdmin(req, isAdmin, () => updateOrganizer(req, service, body));
    if (action === "upsert-terms") return await requireAdmin(req, isAdmin, () => upsertTerms(req, service, callerId, body));
    if (action === "add-contact") return await requireAdmin(req, isAdmin, () => addContact(req, service, body));
    if (action === "update-contact") return await requireAdmin(req, isAdmin, () => updateContact(req, service, body));
    if (action === "deactivate-contact") {
      return await requireAdmin(req, isAdmin, () => setContactActive(req, service, body, false));
    }
    return json(req, { error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "server_error";
    return json(req, { error: message }, 500);
  }
});

async function requireAdmin(req: Request, isAdmin: boolean, fn: () => Promise<Response>) {
  if (!isAdmin) return json(req, { error: "forbidden" }, 403);
  return await fn();
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function termsFields(body: Record<string, unknown>) {
  const default_contract_type = (body.default_contract_type as ContractType) || "NONE";
  if (!CONTRACTS.has(default_contract_type)) return { error: "invalid_contract" as const };
  const default_commission_rate = num(body.default_commission_rate);
  const default_fixed_fee = num(body.default_fixed_fee);
  if (Number.isNaN(default_commission_rate) || Number.isNaN(default_fixed_fee)) {
    return { error: "invalid_contract" as const };
  }
  if (default_commission_rate != null && (default_commission_rate < 0 || default_commission_rate > 100)) {
    return { error: "invalid_contract" as const };
  }
  if (default_fixed_fee != null && default_fixed_fee < 0) return { error: "invalid_contract" as const };
  if (default_contract_type === "COMMISSION" && default_commission_rate == null) {
    return { error: "invalid_contract" as const };
  }
  if (default_contract_type === "FIXED_FEE" && default_fixed_fee == null) {
    return { error: "invalid_contract" as const };
  }
  if (default_contract_type === "MIXED" && (default_commission_rate == null || default_fixed_fee == null)) {
    return { error: "invalid_contract" as const };
  }
  return {
    default_contract_type,
    default_commission_rate,
    default_fixed_fee,
    memo: text(body.memo) || null,
  };
}

async function listOrganizers(req: Request, service: ReturnType<typeof secretClient>) {
  const { data: organizers, error } = await service
    .from("event_organizers")
    .select("*")
    .order("name");
  if (error) throw error;
  const ids = (organizers ?? []).map((row) => row.id);
  const [{ data: terms }, { data: contacts }] = await Promise.all([
    ids.length
      ? service.from("event_organizer_terms").select("*").in("organizer_id", ids)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ids.length
      ? service.from("event_organizer_contacts").select("organizer_id, is_active").in("organizer_id", ids)
      : Promise.resolve({ data: [] as Array<{ organizer_id: string; is_active: boolean }> }),
  ]);
  const termsMap = new Map((terms ?? []).map((row) => [row.organizer_id, row]));
  const countMap = new Map<string, number>();
  for (const row of contacts ?? []) {
    if (!row.is_active) continue;
    countMap.set(row.organizer_id, (countMap.get(row.organizer_id) ?? 0) + 1);
  }
  return json(req, {
    organizers: (organizers ?? []).map((row) => ({
      ...row,
      terms: termsMap.get(row.id) ?? null,
      contact_count: countMap.get(row.id) ?? 0,
    })),
  });
}

async function getOrganizer(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: organizer, error } = await service.from("event_organizers").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!organizer) return json(req, { error: "not_found" }, 404);
  const [{ data: terms }, { data: contacts }] = await Promise.all([
    service.from("event_organizer_terms").select("*").eq("organizer_id", id).maybeSingle(),
    service.from("event_organizer_contacts").select("*").eq("organizer_id", id).order("sort_order"),
  ]);
  return json(req, { organizer, terms: terms ?? null, contacts: contacts ?? [] });
}

async function createOrganizer(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const name = text(body.name);
  const calendar_color = text(body.calendar_color);
  if (!name) return json(req, { error: "invalid_input" }, 400);
  if (!COLOR_RE.test(calendar_color)) return json(req, { error: "invalid_color" }, 400);
  const terms = termsFields(body);
  if ("error" in terms) return json(req, { error: terms.error }, 400);

  const { data: organizer, error } = await service
    .from("event_organizers")
    .insert({
      name,
      calendar_color,
      is_active: body.is_active === false ? false : true,
      created_by: callerId,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return json(req, { error: "duplicate_name" }, 409);
    return json(req, { error: error.message }, 400);
  }
  const { data: savedTerms, error: termsError } = await service
    .from("event_organizer_terms")
    .insert({ organizer_id: organizer.id, updated_by: callerId, ...terms })
    .select("*")
    .maybeSingle();
  if (termsError) return json(req, { error: termsError.message }, 400);
  return json(req, { organizer, terms: savedTerms, contacts: [] });
}

async function updateOrganizer(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const patch: Record<string, unknown> = {};
  if ("name" in body) {
    const name = text(body.name);
    if (!name) return json(req, { error: "invalid_input" }, 400);
    patch.name = name;
  }
  if ("calendar_color" in body) {
    const calendar_color = text(body.calendar_color);
    if (!COLOR_RE.test(calendar_color)) return json(req, { error: "invalid_color" }, 400);
    patch.calendar_color = calendar_color;
  }
  if ("is_active" in body) patch.is_active = Boolean(body.is_active);
  if (Object.keys(patch).length === 0) return json(req, { error: "invalid_input" }, 400);

  const { data, error } = await service.from("event_organizers").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) {
    if (error.code === "23505") return json(req, { error: "duplicate_name" }, 409);
    return json(req, { error: error.message }, 400);
  }
  if (!data) return json(req, { error: "not_found" }, 404);
  return json(req, { organizer: data });
}

async function upsertTerms(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const organizer_id = text(body.organizer_id);
  if (!organizer_id) return json(req, { error: "invalid_input" }, 400);
  const { data: organizer } = await service.from("event_organizers").select("id").eq("id", organizer_id).maybeSingle();
  if (!organizer) return json(req, { error: "not_found" }, 404);
  const terms = termsFields(body);
  if ("error" in terms) return json(req, { error: terms.error }, 400);
  const { data, error } = await service
    .from("event_organizer_terms")
    .upsert({ organizer_id, updated_by: callerId, ...terms }, { onConflict: "organizer_id" })
    .select("*")
    .maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { terms: data });
}

async function addContact(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const organizer_id = text(body.organizer_id);
  const name = text(body.name);
  const contact_type = body.contact_type as ContactType;
  if (!organizer_id || !name || !CONTACTS.has(contact_type)) return json(req, { error: "invalid_input" }, 400);
  const { data: last } = await service
    .from("event_organizer_contacts")
    .select("sort_order")
    .eq("organizer_id", organizer_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = {
    organizer_id,
    contact_type,
    name,
    department: text(body.department) || null,
    position: text(body.position) || null,
    phone: text(body.phone) || null,
    email: text(body.email) || null,
    memo: text(body.memo) || null,
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : (last?.sort_order ?? 0) + 1,
    is_active: body.is_active === false ? false : true,
  };
  const { data, error } = await service.from("event_organizer_contacts").insert(row).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { contact: data });
}

async function updateContact(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const patch: Record<string, unknown> = {};
  if (body.contact_type) {
    if (!CONTACTS.has(body.contact_type as ContactType)) return json(req, { error: "invalid_input" }, 400);
    patch.contact_type = body.contact_type;
  }
  if ("name" in body) patch.name = text(body.name);
  if ("department" in body) patch.department = text(body.department) || null;
  if ("position" in body) patch.position = text(body.position) || null;
  if ("phone" in body) patch.phone = text(body.phone) || null;
  if ("email" in body) patch.email = text(body.email) || null;
  if ("memo" in body) patch.memo = text(body.memo) || null;
  if ("sort_order" in body) patch.sort_order = Number(body.sort_order);
  if ("is_active" in body) patch.is_active = Boolean(body.is_active);
  const { data, error } = await service.from("event_organizer_contacts").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_found" }, 404);
  return json(req, { contact: data });
}

async function setContactActive(
  req: Request,
  service: ReturnType<typeof secretClient>,
  body: Record<string, unknown>,
  is_active: boolean,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data, error } = await service
    .from("event_organizer_contacts")
    .update({ is_active })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_found" }, 404);
  return json(req, { contact: data });
}
