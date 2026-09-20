import { json, preflight } from "../_shared/http.ts";
import { hasAppAccess } from "../_shared/crypto.ts";
import { callerUserId, secretClient } from "../_shared/supabase.ts";

type AppRole = "ADMIN" | "STAFF" | "PART_TIMER";
type EventStatus = "PREPARING" | "ACTIVE" | "ENDED" | "SETTLED" | "CANCELLED";
type ContractType = "NONE" | "COMMISSION" | "FIXED_FEE" | "MIXED";
type AssignmentRole = "MANAGER" | "STAFF" | "PART_TIMER";
type ContactType = "VENUE" | "HQ" | "OTHER";

type Profile = {
  id: string;
  role: AppRole;
  is_active: boolean;
  login_allowed_from: string | null;
  login_allowed_until: string | null;
};

const STATUSES = new Set<EventStatus>(["PREPARING", "ACTIVE", "ENDED", "SETTLED", "CANCELLED"]);
const CONTRACTS = new Set<ContractType>(["NONE", "COMMISSION", "FIXED_FEE", "MIXED"]);
const ASSIGNMENTS = new Set<AssignmentRole>(["MANAGER", "STAFF", "PART_TIMER"]);
const CONTACTS = new Set<ContactType>(["VENUE", "HQ", "OTHER"]);

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

    const body = await req.json();
    const action = body?.action as string;
    const isAdmin = caller.role === "ADMIN";

    if (action === "get") return await getEvent(req, service, callerId, isAdmin, body);
    if (action === "calendar") return await calendarEvents(req, service, callerId, isAdmin, body);
    if (action === "create") return await requireAdmin(req, isAdmin, () => createEvent(req, service, callerId, body));
    if (action === "update") return await requireAdmin(req, isAdmin, () => updateEvent(req, service, body));
    if (action === "set-status") return await requireAdmin(req, isAdmin, () => setStatus(req, service, body));
    if (action === "add-member") return await requireAdmin(req, isAdmin, () => addMember(req, service, callerId, body));
    if (action === "remove-member") return await requireAdmin(req, isAdmin, () => removeMember(req, service, body));
    if (action === "add-contact") return await requireAdmin(req, isAdmin, () => addContact(req, service, body));
    if (action === "update-contact") return await requireAdmin(req, isAdmin, () => updateContact(req, service, body));
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

function contractFields(body: Record<string, unknown>) {
  const contract_type = (body.contract_type as ContractType) || "NONE";
  if (!CONTRACTS.has(contract_type)) return { error: "invalid_contract" as const };
  const commission_rate = num(body.commission_rate);
  const fixed_fee = num(body.fixed_fee);
  if (Number.isNaN(commission_rate) || Number.isNaN(fixed_fee)) return { error: "invalid_contract" as const };
  if (commission_rate != null && (commission_rate < 0 || commission_rate > 100)) return { error: "invalid_contract" as const };
  if (fixed_fee != null && fixed_fee < 0) return { error: "invalid_contract" as const };
  if (contract_type === "COMMISSION" && commission_rate == null) return { error: "invalid_contract" as const };
  if (contract_type === "FIXED_FEE" && fixed_fee == null) return { error: "invalid_contract" as const };
  if (contract_type === "MIXED" && (commission_rate == null || fixed_fee == null)) return { error: "invalid_contract" as const };
  return {
    contract_type,
    commission_rate: contract_type === "NONE" || contract_type === "FIXED_FEE" ? commission_rate : commission_rate,
    fixed_fee: contract_type === "NONE" || contract_type === "COMMISSION" ? fixed_fee : fixed_fee,
    contract_memo: text(body.contract_memo) || null,
  };
}

function parseRange(starts_at: string, ends_at: string) {
  const start = Date.parse(starts_at);
  const end = Date.parse(ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: "invalid_range" as const };
  if (end < start) return { error: "invalid_range" as const };
  return { starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() };
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

function publicEvent(row: Record<string, unknown>, isAdmin: boolean) {
  if (isAdmin) return row;
  const { commission_rate: _rate, fixed_fee: _fee, ...safe } = row;
  return safe;
}

function calendarDto(row: {
  id: string;
  name: string;
  venue_name: string;
  starts_at: string;
  ends_at: string;
  status: EventStatus;
  organizer_id: string | null;
  event_organizers:
    | { id: string; name: string; calendar_color: string }
    | { id: string; name: string; calendar_color: string }[]
    | null;
}) {
  const raw = row.event_organizers;
  const organizer = Array.isArray(raw) ? (raw[0] ?? null) : raw;
  return {
    id: row.id,
    name: row.name,
    venue_name: row.venue_name,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status: row.status,
    organizer_id: row.organizer_id,
    organizer_name: organizer?.name ?? null,
    organizer_color: organizer?.calendar_color ?? null,
  };
}

async function loadOrganizerSafe(service: ReturnType<typeof secretClient>, organizerId: string | null) {
  if (!organizerId) return null;
  const { data } = await service
    .from("event_organizers")
    .select("id, name, calendar_color, is_active")
    .eq("id", organizerId)
    .maybeSingle();
  return data ?? null;
}

async function resolveContract(
  service: ReturnType<typeof secretClient>,
  body: Record<string, unknown>,
  organizerId: string | null,
) {
  const hasContractInput = "contract_type" in body;
  if (!hasContractInput && organizerId) {
    const { data: terms } = await service
      .from("event_organizer_terms")
      .select("*")
      .eq("organizer_id", organizerId)
      .maybeSingle();
    return contractFields({
      contract_type: terms?.default_contract_type ?? "NONE",
      commission_rate: terms?.default_commission_rate ?? null,
      fixed_fee: terms?.default_fixed_fee ?? null,
      contract_memo: terms?.memo ?? null,
    });
  }
  return contractFields(body);
}

async function copyOrganizerContacts(
  service: ReturnType<typeof secretClient>,
  eventId: string,
  organizerId: string,
  organizerName: string,
  contactIds: string[],
) {
  if (contactIds.length === 0) return;
  const { data: contacts } = await service
    .from("event_organizer_contacts")
    .select("*")
    .eq("organizer_id", organizerId)
    .in("id", contactIds)
    .eq("is_active", true)
    .order("sort_order");
  if (!contacts?.length) return;
  const rows = contacts.map((contact, index) => ({
    event_id: eventId,
    contact_type: contact.contact_type,
    name: contact.name,
    company: organizerName,
    department: contact.department,
    position: contact.position,
    phone: contact.phone,
    email: contact.email,
    memo: contact.memo,
    sort_order: index + 1,
  }));
  const { error } = await service.from("event_contacts").insert(rows);
  if (error) throw error;
}

async function getEvent(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  if (!(await canRead(service, id, callerId, isAdmin))) {
    return json(req, { error: "not_found" }, 404);
  }

  const { data: event, error } = await service.from("events").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!event) return json(req, { error: "not_found" }, 404);

  const [{ data: members }, { data: contacts }, { data: photos }, organizer] = await Promise.all([
    service.from("event_members").select("*").eq("event_id", id).order("created_at"),
    service.from("event_contacts").select("*").eq("event_id", id).order("sort_order"),
    service.from("event_photos").select("*").eq("event_id", id).order("created_at"),
    loadOrganizerSafe(service, event.organizer_id),
  ]);

  const profileIds = [...new Set((members ?? []).map((row) => row.profile_id))];
  const { data: profiles } = profileIds.length
    ? await service.from("profiles").select("id, display_name, phone, role").in("id", profileIds)
    : { data: [] as Array<{ id: string; display_name: string; phone: string; role: AppRole }> };

  const profileMap = new Map((profiles ?? []).map((row) => [row.id, row]));
  const photoRows = photos ?? [];
  const signed = await Promise.all(
    photoRows.map(async (photo) => {
      const { data } = await service.storage.from("event-photos").createSignedUrl(photo.storage_path, 3600);
      return { ...photo, signed_url: data?.signedUrl ?? null };
    }),
  );

  return json(req, {
    event: publicEvent(event, isAdmin),
    organizer,
    members: (members ?? []).map((row) => ({
      ...row,
      display_name: profileMap.get(row.profile_id)?.display_name ?? "",
      phone: profileMap.get(row.profile_id)?.phone ?? "",
      system_role: profileMap.get(row.profile_id)?.role ?? null,
    })),
    contacts: contacts ?? [],
    photos: signed,
  });
}

async function calendarEvents(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const from = text(body.from);
  const to = text(body.to);
  if (!from || !to) return json(req, { error: "invalid_input" }, 400);
  const fromIso = Date.parse(from);
  const toIso = Date.parse(to);
  if (!Number.isFinite(fromIso) || !Number.isFinite(toIso)) return json(req, { error: "invalid_range" }, 400);

  let query = service
    .from("events")
    .select("id, name, venue_name, starts_at, ends_at, status, organizer_id, event_organizers(id, name, calendar_color)")
    .lte("starts_at", new Date(toIso).toISOString())
    .gte("ends_at", new Date(fromIso).toISOString())
    .order("starts_at");

  if (!isAdmin) {
    const { data: memberships } = await service.from("event_members").select("event_id").eq("profile_id", callerId);
    const ids = (memberships ?? []).map((row) => row.event_id);
    if (ids.length === 0) return json(req, { events: [] });
    query = query.in("id", ids);
  }

  const organizerFilter = text(body.organizer_id);
  if (organizerFilter) query = query.eq("organizer_id", organizerFilter);

  const { data, error } = await query;
  if (error) throw error;
  return json(req, {
    events: (data ?? []).map((row) =>
      calendarDto(
        row as {
          id: string;
          name: string;
          venue_name: string;
          starts_at: string;
          ends_at: string;
          status: EventStatus;
          organizer_id: string | null;
          event_organizers: { id: string; name: string; calendar_color: string } | null;
        },
      ),
    ),
  });
}

async function createEvent(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const name = text(body.name);
  const venue_name = text(body.venue_name);
  const address = text(body.address);
  const status = (body.status as EventStatus) || "PREPARING";
  if (!name || !venue_name || !address) return json(req, { error: "invalid_input" }, 400);
  if (!STATUSES.has(status)) return json(req, { error: "invalid_input" }, 400);

  const range = parseRange(text(body.starts_at), text(body.ends_at));
  if ("error" in range) return json(req, { error: range.error }, 400);

  const organizer_id = text(body.organizer_id) || null;
  let organizerName = "";
  if (organizer_id) {
    const { data: organizer } = await service
      .from("event_organizers")
      .select("id, name")
      .eq("id", organizer_id)
      .maybeSingle();
    if (!organizer) return json(req, { error: "organizer_not_found" }, 404);
    organizerName = organizer.name;
  }

  const contract = await resolveContract(service, body, organizer_id);
  if ("error" in contract) return json(req, { error: contract.error }, 400);

  const row = {
    name,
    venue_name,
    address,
    address_detail: text(body.address_detail) || null,
    memo: text(body.memo) || null,
    status,
    created_by: callerId,
    organizer_id,
    ...range,
    ...contract,
  };

  const { data, error } = await service.from("events").insert(row).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);

  const copyIds = Array.isArray(body.copy_contact_ids)
    ? (body.copy_contact_ids as unknown[]).map((id) => text(id)).filter(Boolean)
    : [];
  if (organizer_id && copyIds.length) {
    await copyOrganizerContacts(service, data.id, organizer_id, organizerName, copyIds);
  }
  return json(req, { event: data });
}

async function updateEvent(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: current } = await service.from("events").select("*").eq("id", id).maybeSingle();
  if (!current) return json(req, { error: "not_found" }, 404);

  const starts_at = text(body.starts_at) || current.starts_at;
  const ends_at = text(body.ends_at) || current.ends_at;
  const range = parseRange(starts_at, ends_at);
  if ("error" in range) return json(req, { error: range.error }, 400);

  const contractBody = {
    contract_type: body.contract_type ?? current.contract_type,
    commission_rate: "commission_rate" in body ? body.commission_rate : current.commission_rate,
    fixed_fee: "fixed_fee" in body ? body.fixed_fee : current.fixed_fee,
    contract_memo: "contract_memo" in body ? body.contract_memo : current.contract_memo,
  };
  const contract = contractFields(contractBody);
  if ("error" in contract) return json(req, { error: contract.error }, 400);

  const patch: Record<string, unknown> = { ...range, ...contract };
  if ("organizer_id" in body) {
    const organizer_id = text(body.organizer_id) || null;
    if (organizer_id) {
      const { data: organizer } = await service.from("event_organizers").select("id").eq("id", organizer_id).maybeSingle();
      if (!organizer) return json(req, { error: "organizer_not_found" }, 404);
    }
    patch.organizer_id = organizer_id;
  }
  if ("name" in body) patch.name = text(body.name);
  if ("venue_name" in body) patch.venue_name = text(body.venue_name);
  if ("address" in body) patch.address = text(body.address);
  if ("address_detail" in body) patch.address_detail = text(body.address_detail) || null;
  if ("memo" in body) patch.memo = text(body.memo) || null;
  if (body.status) {
    if (!STATUSES.has(body.status as EventStatus)) return json(req, { error: "invalid_input" }, 400);
    patch.status = body.status;
  }

  const { data, error } = await service.from("events").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { event: data });
}

async function setStatus(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  const status = body.status as EventStatus;
  if (!id || !STATUSES.has(status)) return json(req, { error: "invalid_input" }, 400);
  const { data, error } = await service.from("events").update({ status }).eq("id", id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_found" }, 404);
  return json(req, { event: data });
}

async function addMember(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const profile_id = text(body.profile_id);
  const assignment_role = body.assignment_role as AssignmentRole;
  if (!event_id || !profile_id || !ASSIGNMENTS.has(assignment_role)) {
    return json(req, { error: "invalid_input" }, 400);
  }

  const [{ data: event }, { data: profile }] = await Promise.all([
    service.from("events").select("id").eq("id", event_id).maybeSingle(),
    service.from("profiles").select("id, login_allowed_from, login_allowed_until").eq("id", profile_id).maybeSingle(),
  ]);
  if (!event || !profile) return json(req, { error: "not_found" }, 404);

  const loginBefore = {
    login_allowed_from: profile.login_allowed_from,
    login_allowed_until: profile.login_allowed_until,
  };

  const { data, error } = await service
    .from("event_members")
    .insert({ event_id, profile_id, assignment_role, created_by: callerId })
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return json(req, { error: "duplicate_member" }, 409);
    return json(req, { error: error.message }, 400);
  }

  const { data: after } = await service
    .from("profiles")
    .select("login_allowed_from, login_allowed_until")
    .eq("id", profile_id)
    .maybeSingle();

  return json(req, {
    member: data,
    login_window_unchanged:
      after?.login_allowed_from === loginBefore.login_allowed_from &&
      after?.login_allowed_until === loginBefore.login_allowed_until,
  });
}

async function removeMember(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const event_id = text(body.event_id);
  const profile_id = text(body.profile_id);
  if (!event_id || !profile_id) return json(req, { error: "invalid_input" }, 400);

  const { data: event } = await service.from("events").select("id").eq("id", event_id).maybeSingle();
  if (!event) return json(req, { error: "not_found" }, 404);

  const { data: existing } = await service
    .from("event_members")
    .select("id")
    .eq("event_id", event_id)
    .eq("profile_id", profile_id)
    .maybeSingle();
  if (!existing) return json(req, { removed: true, already_removed: true });

  const { error } = await service.from("event_members").delete().eq("event_id", event_id).eq("profile_id", profile_id);
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { removed: true, already_removed: false });
}

async function addContact(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const event_id = text(body.event_id);
  const name = text(body.name);
  const contact_type = body.contact_type as ContactType;
  if (!event_id || !name || !CONTACTS.has(contact_type)) return json(req, { error: "invalid_input" }, 400);

  const { data: last } = await service
    .from("event_contacts")
    .select("sort_order")
    .eq("event_id", event_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = {
    event_id,
    contact_type,
    name,
    company: text(body.company) || null,
    department: text(body.department) || null,
    position: text(body.position) || null,
    phone: text(body.phone) || null,
    email: text(body.email) || null,
    memo: text(body.memo) || null,
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : (last?.sort_order ?? 0) + 1,
  };

  const { data, error } = await service.from("event_contacts").insert(row).select("*").maybeSingle();
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
  if ("company" in body) patch.company = text(body.company) || null;
  if ("department" in body) patch.department = text(body.department) || null;
  if ("position" in body) patch.position = text(body.position) || null;
  if ("phone" in body) patch.phone = text(body.phone) || null;
  if ("email" in body) patch.email = text(body.email) || null;
  if ("memo" in body) patch.memo = text(body.memo) || null;
  if ("sort_order" in body) patch.sort_order = Number(body.sort_order);

  const { data, error } = await service.from("event_contacts").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_found" }, 404);
  return json(req, { contact: data });
}
