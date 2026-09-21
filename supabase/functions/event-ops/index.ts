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

const SESSION_STATUSES = new Set(["PLANNED", "ARRIVED", "COMPLETED"]);
const FIXTURE_TYPES = new Set(["TABLE", "RACK", "DISPLAY", "HANGER", "SIGNAGE", "OTHER"]);
const MEMBER_ROLES = new Set(["LEAD", "MEMBER"]);
const PHOTO_TYPES = new Set(["ARRIVAL", "COMPLETION", "OTHER"]);
const LOCATION_TYPES = new Set(["OFFICE", "HOME_BASE", "LODGING", "STORAGE", "OTHER"]);
const SUBJECTS = new Set(["GEAR", "CREW", "BOTH"]);
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"]);
const MAX_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  try {
    const callerId = await callerUserId(req);
    if (!callerId) return json(req, { error: "unauthorized" }, 401);
    const service = secretClient();
    const { data: caller, error: callerError } = await service.from("profiles").select("*").eq("id", callerId).maybeSingle();
    if (callerError) throw callerError;
    if (!caller || !hasAppAccess(caller as Profile)) return json(req, { error: "forbidden" }, 403);

    const body = await req.json();
    const action = body?.action as string;
    const isAdmin = caller.role === "ADMIN";

    if (action === "get-setup") return await getSetup(req, service, callerId, isAdmin, body);
    if (action === "save-plan") return await requireAdmin(req, isAdmin, () => savePlan(req, service, callerId, body));
    if (action === "add-fixture") return await requireAdmin(req, isAdmin, () => addFixture(req, service, body));
    if (action === "update-fixture") return await updateFixture(req, service, callerId, isAdmin, body);
    if (action === "remove-fixture") return await requireAdmin(req, isAdmin, () => removeFixture(req, service, body));
    if (action === "set-members") return await requireAdmin(req, isAdmin, () => setMembers(req, service, body));
    if (action === "save-actuals") return await saveActuals(req, service, callerId, isAdmin, body);
    if (action === "adjust-times") return await requireAdmin(req, isAdmin, () => adjustTimes(req, service, callerId, body));
    if (action === "sign-upload") return await signUpload(req, service, callerId, isAdmin, body);
    if (action === "complete-upload") return await completeUpload(req, service, callerId, isAdmin, body);
    if (action === "list-locations") return await requireAdmin(req, isAdmin, () => listLocations(req, service));
    if (action === "create-location") return await requireAdmin(req, isAdmin, () => createLocation(req, service, callerId, body));
    if (action === "update-location") return await requireAdmin(req, isAdmin, () => updateLocation(req, service, body));
    if (action === "list-transitions") return await listTransitions(req, service, callerId, isAdmin, body);
    if (action === "save-transition") return await requireAdmin(req, isAdmin, () => saveTransition(req, service, callerId, body));
    if (action === "save-transition-actuals") return await saveTransitionActuals(req, service, callerId, isAdmin, body);
    return json(req, { error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "server_error";
    if (message === "raw_timestamp_immutable" || message === "setup_photo_immutable") {
      return json(req, { error: message }, 403);
    }
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

function int(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return NaN;
  return n;
}

function iso(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return "invalid";
  return new Date(parsed).toISOString();
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

async function loadSession(
  service: ReturnType<typeof secretClient>,
  sessionId: string,
) {
  const { data } = await service.from("event_setup_sessions").select("*").eq("id", sessionId).maybeSingle();
  return data;
}

function unitFrontageMm(row: { width_mm: number | null; frontage_mm_per_unit: number | null }) {
  return row.frontage_mm_per_unit ?? row.width_mm;
}

function fixtureSummary(fixtures: Array<Record<string, unknown>>) {
  const rows = fixtures as Array<{
    fixture_type: string;
    planned_quantity: number;
    actual_quantity: number | null;
    width_mm: number | null;
    frontage_mm_per_unit: number | null;
    rack_levels: number | null;
  }>;
  let planned_table_count = 0;
  let actual_table_count = 0;
  let planned_table_frontage_mm = 0;
  let actual_table_frontage_mm = 0;
  let planned_rack_count = 0;
  let actual_rack_count = 0;
  let planned_total_rack_levels = 0;
  let actual_total_rack_levels = 0;
  let other_planned = 0;
  let other_actual = 0;
  for (const row of rows) {
    const planned = row.planned_quantity;
    const actual = row.actual_quantity;
    if (row.fixture_type === "TABLE") {
      planned_table_count += planned;
      actual_table_count += actual ?? 0;
      const unit = unitFrontageMm(row) ?? 0;
      planned_table_frontage_mm += unit * planned;
      actual_table_frontage_mm += unit * (actual ?? 0);
    } else if (row.fixture_type === "RACK") {
      planned_rack_count += planned;
      actual_rack_count += actual ?? 0;
      const levels = row.rack_levels ?? 0;
      planned_total_rack_levels += levels * planned;
      actual_total_rack_levels += levels * (actual ?? 0);
    } else {
      other_planned += planned;
      other_actual += actual ?? 0;
    }
  }
  return {
    planned_table_count,
    actual_table_count,
    planned_table_frontage_mm,
    actual_table_frontage_mm,
    planned_table_frontage_m: planned_table_frontage_mm / 1000,
    actual_table_frontage_m: actual_table_frontage_mm / 1000,
    planned_rack_count,
    actual_rack_count,
    planned_total_rack_levels,
    actual_total_rack_levels,
    other_planned_count: other_planned,
    other_actual_count: other_actual,
    fixture_total_count: rows.reduce((sum, row) => sum + row.planned_quantity, 0),
  };
}

function effectiveTimes(session: {
  arrival_recorded_at: string | null;
  completed_recorded_at: string | null;
  adjusted_arrival_at: string | null;
  adjusted_completed_at: string | null;
}) {
  const effective_arrival_at = session.adjusted_arrival_at ?? session.arrival_recorded_at;
  const effective_completed_at = session.adjusted_completed_at ?? session.completed_recorded_at;
  let duration_minutes: number | null = null;
  if (effective_arrival_at && effective_completed_at) {
    duration_minutes = Math.round((Date.parse(effective_completed_at) - Date.parse(effective_arrival_at)) / 60000);
  }
  return { effective_arrival_at, effective_completed_at, duration_minutes };
}

async function getSetup(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  if (!event_id) return json(req, { error: "invalid_input" }, 400);
  if (!(await canRead(service, event_id, callerId, isAdmin))) return json(req, { error: "not_found" }, 404);

  const { data: sessions } = await service
    .from("event_setup_sessions")
    .select("*")
    .eq("event_id", event_id)
    .order("created_at", { ascending: false });
  const session = (sessions ?? [])[0] ?? null;
  if (!session) {
    return json(req, { session: null, fixtures: [], members: [], photos: [], summary: fixtureSummary([]), transitions: [] });
  }

  const [{ data: fixtures }, { data: members }, { data: photos }] = await Promise.all([
    service.from("event_setup_fixtures").select("*").eq("setup_session_id", session.id).order("sort_order"),
    service.from("event_setup_members").select("*").eq("setup_session_id", session.id),
    service.from("event_setup_photos").select("*").eq("setup_session_id", session.id).order("recorded_at"),
  ]);

  const profileIds = [...new Set((members ?? []).map((row) => row.profile_id))];
  const { data: profiles } = profileIds.length
    ? await service.from("profiles").select("id, display_name, phone, role").in("id", profileIds)
    : { data: [] as Array<{ id: string; display_name: string }> };
  const profileMap = new Map((profiles ?? []).map((row) => [row.id, row]));

  const signed = await Promise.all(
    (photos ?? []).map(async (photo) => {
      const { data } = await service.storage.from("setup-photos").createSignedUrl(photo.storage_path, 3600);
      return { ...photo, signed_url: data?.signedUrl ?? null };
    }),
  );

  const { data: transitions } = await service
    .from("event_transition_legs")
    .select("*")
    .or(`from_event_id.eq.${event_id},to_event_id.eq.${event_id}`)
    .order("created_at");

  return json(req, {
    session: { ...session, ...effectiveTimes(session) },
    fixtures: fixtures ?? [],
    members: (members ?? []).map((row) => ({
      ...row,
      display_name: profileMap.get(row.profile_id)?.display_name ?? "",
    })),
    photos: signed,
    summary: fixtureSummary(fixtures ?? []),
    transitions: transitions ?? [],
  });
}

async function savePlan(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  if (!event_id) return json(req, { error: "invalid_input" }, 400);
  const { data: event } = await service.from("events").select("id").eq("id", event_id).maybeSingle();
  if (!event) return json(req, { error: "not_found" }, 404);

  const planned_start_at = iso(body.planned_start_at);
  const planned_end_at = iso(body.planned_end_at);
  if (planned_start_at === "invalid" || planned_end_at === "invalid") return json(req, { error: "invalid_range" }, 400);
  if (planned_start_at && planned_end_at && Date.parse(planned_end_at) < Date.parse(planned_start_at)) {
    return json(req, { error: "invalid_range" }, 400);
  }
  const planned_staff_count = int(body.planned_staff_count);
  if (Number.isNaN(planned_staff_count as number) || (planned_staff_count != null && planned_staff_count < 0)) {
    return json(req, { error: "invalid_input" }, 400);
  }

  const patch = {
    planned_start_at,
    planned_end_at,
    planned_staff_count,
    setup_notes: text(body.setup_notes) || null,
  };

  const session_id = text(body.session_id);
  if (session_id) {
    const { data, error } = await service.from("event_setup_sessions").update(patch).eq("id", session_id).eq("event_id", event_id).select("*").maybeSingle();
    if (error) return json(req, { error: error.message }, 400);
    if (!data) return json(req, { error: "not_found" }, 404);
    return json(req, { session: data });
  }

  const { data, error } = await service
    .from("event_setup_sessions")
    .insert({ event_id, created_by: callerId, status: "PLANNED", ...patch })
    .select("*")
    .maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { session: data });
}

async function addFixture(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const setup_session_id = text(body.setup_session_id);
  const fixture_type = text(body.fixture_type);
  const name_snapshot = text(body.name_snapshot);
  const planned_quantity = int(body.planned_quantity);
  if (!setup_session_id || !FIXTURE_TYPES.has(fixture_type) || !name_snapshot || planned_quantity == null || Number.isNaN(planned_quantity) || planned_quantity < 0) {
    return json(req, { error: "invalid_input" }, 400);
  }
  const session = await loadSession(service, setup_session_id);
  if (!session) return json(req, { error: "not_found" }, 404);

  let snapshot = name_snapshot;
  const preparation_item_id = text(body.preparation_item_id) || null;
  if (preparation_item_id) {
    const { data: item } = await service.from("preparation_items").select("id, name").eq("id", preparation_item_id).maybeSingle();
    if (!item) return json(req, { error: "preparation_item_not_found" }, 404);
    if (!name_snapshot) snapshot = item.name;
  }

  const width_mm = int(body.width_mm);
  const depth_mm = int(body.depth_mm);
  const height_mm = int(body.height_mm);
  const frontage_mm_per_unit = int(body.frontage_mm_per_unit);
  const rack_levels = int(body.rack_levels);
  const actual_quantity = int(body.actual_quantity);
  const sort_order = int(body.sort_order) ?? 0;
  for (const value of [width_mm, depth_mm, height_mm, frontage_mm_per_unit, rack_levels, actual_quantity, sort_order]) {
    if (Number.isNaN(value as number)) return json(req, { error: "invalid_input" }, 400);
  }
  if ((width_mm != null && width_mm <= 0) || (depth_mm != null && depth_mm <= 0) || (height_mm != null && height_mm <= 0)) {
    return json(req, { error: "invalid_input" }, 400);
  }
  if (frontage_mm_per_unit != null && frontage_mm_per_unit <= 0) return json(req, { error: "invalid_input" }, 400);
  if (rack_levels != null && rack_levels <= 0) return json(req, { error: "invalid_input" }, 400);
  if (actual_quantity != null && actual_quantity < 0) return json(req, { error: "invalid_input" }, 400);

  const { data, error } = await service
    .from("event_setup_fixtures")
    .insert({
      setup_session_id,
      fixture_type,
      name_snapshot: snapshot,
      preparation_item_id,
      width_mm,
      depth_mm,
      height_mm,
      frontage_mm_per_unit,
      planned_quantity,
      actual_quantity,
      rack_levels,
      layout_note: text(body.layout_note) || null,
      sort_order,
    })
    .select("*")
    .maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { fixture: data, summary: fixtureSummary([...(await sessionFixtures(service, setup_session_id))]) });
}

async function sessionFixtures(service: ReturnType<typeof secretClient>, setup_session_id: string) {
  const { data } = await service.from("event_setup_fixtures").select("*").eq("setup_session_id", setup_session_id);
  return data ?? [];
}

async function updateFixture(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: current } = await service.from("event_setup_fixtures").select("*").eq("id", id).maybeSingle();
  if (!current) return json(req, { error: "not_found" }, 404);
  const session = await loadSession(service, current.setup_session_id);
  if (!session || !(await canRead(service, session.event_id, callerId, isAdmin))) return json(req, { error: "not_found" }, 404);

  const patch: Record<string, unknown> = {};
  if (isAdmin) {
    if ("fixture_type" in body) {
      const fixture_type = text(body.fixture_type);
      if (!FIXTURE_TYPES.has(fixture_type)) return json(req, { error: "invalid_input" }, 400);
      patch.fixture_type = fixture_type;
    }
    if ("name_snapshot" in body) patch.name_snapshot = text(body.name_snapshot);
    if ("planned_quantity" in body) {
      const planned_quantity = int(body.planned_quantity);
      if (planned_quantity == null || Number.isNaN(planned_quantity) || planned_quantity < 0) return json(req, { error: "invalid_input" }, 400);
      patch.planned_quantity = planned_quantity;
    }
    for (const key of ["width_mm", "depth_mm", "height_mm", "frontage_mm_per_unit", "rack_levels", "sort_order"] as const) {
      if (key in body) {
        const value = int(body[key]);
        if (Number.isNaN(value as number)) return json(req, { error: "invalid_input" }, 400);
        if (value != null && value <= 0 && key !== "sort_order") return json(req, { error: "invalid_input" }, 400);
        patch[key] = value;
      }
    }
    if ("layout_note" in body) patch.layout_note = text(body.layout_note) || null;
    if ("preparation_item_id" in body) patch.preparation_item_id = text(body.preparation_item_id) || null;
  }
  if ("actual_quantity" in body) {
    const actual_quantity = int(body.actual_quantity);
    if (Number.isNaN(actual_quantity as number) || (actual_quantity != null && actual_quantity < 0)) {
      return json(req, { error: "invalid_input" }, 400);
    }
    patch.actual_quantity = actual_quantity;
  }
  if (Object.keys(patch).length === 0) return json(req, { error: "invalid_input" }, 400);

  const { data, error } = await service.from("event_setup_fixtures").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { fixture: data, summary: fixtureSummary(await sessionFixtures(service, current.setup_session_id)) });
}

async function removeFixture(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: current } = await service.from("event_setup_fixtures").select("*").eq("id", id).maybeSingle();
  if (!current) return json(req, { error: "not_found" }, 404);
  const session = await loadSession(service, current.setup_session_id);
  if (!session) return json(req, { error: "not_found" }, 404);
  if (session.status === "COMPLETED") return json(req, { error: "session_completed" }, 409);
  const { error } = await service.from("event_setup_fixtures").delete().eq("id", id);
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { ok: true, summary: fixtureSummary(await sessionFixtures(service, current.setup_session_id)) });
}

async function setMembers(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const setup_session_id = text(body.setup_session_id);
  const members = Array.isArray(body.members) ? body.members : null;
  if (!setup_session_id || !members) return json(req, { error: "invalid_input" }, 400);
  const session = await loadSession(service, setup_session_id);
  if (!session) return json(req, { error: "not_found" }, 404);

  const rows = [];
  for (const item of members as Array<Record<string, unknown>>) {
    const profile_id = text(item.profile_id);
    const role = text(item.role) || "MEMBER";
    if (!profile_id || !MEMBER_ROLES.has(role)) return json(req, { error: "invalid_input" }, 400);
    rows.push({ setup_session_id, profile_id, role });
  }
  await service.from("event_setup_members").delete().eq("setup_session_id", setup_session_id);
  if (rows.length) {
    const { error } = await service.from("event_setup_members").insert(rows);
    if (error) return json(req, { error: error.message }, 400);
  }
  const { data } = await service.from("event_setup_members").select("*").eq("setup_session_id", setup_session_id);
  return json(req, { members: data ?? [] });
}

async function saveActuals(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const session_id = text(body.session_id);
  if (!session_id) return json(req, { error: "invalid_input" }, 400);
  const session = await loadSession(service, session_id);
  if (!session || !(await canRead(service, session.event_id, callerId, isAdmin))) return json(req, { error: "not_found" }, 404);
  const actual_staff_count = "actual_staff_count" in body ? int(body.actual_staff_count) : undefined;
  if (actual_staff_count !== undefined && (Number.isNaN(actual_staff_count as number) || (actual_staff_count != null && actual_staff_count < 0))) {
    return json(req, { error: "invalid_input" }, 400);
  }
  const patch: Record<string, unknown> = {};
  if (actual_staff_count !== undefined) patch.actual_staff_count = actual_staff_count;
  if ("actual_notes" in body) patch.actual_notes = text(body.actual_notes) || null;
  if (Object.keys(patch).length === 0) return json(req, { error: "invalid_input" }, 400);
  const { data, error } = await service.from("event_setup_sessions").update(patch).eq("id", session_id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { session: { ...data, ...effectiveTimes(data) } });
}

async function adjustTimes(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const session_id = text(body.session_id);
  const reason = text(body.adjustment_reason);
  if (!session_id || !reason) return json(req, { error: "invalid_input" }, 400);
  const session = await loadSession(service, session_id);
  if (!session) return json(req, { error: "not_found" }, 404);
  const adjusted_arrival_at = iso(body.adjusted_arrival_at);
  const adjusted_completed_at = iso(body.adjusted_completed_at);
  if (adjusted_arrival_at === "invalid" || adjusted_completed_at === "invalid") return json(req, { error: "invalid_range" }, 400);
  const nextArrival = adjusted_arrival_at === null && "adjusted_arrival_at" in body ? null : adjusted_arrival_at ?? session.adjusted_arrival_at;
  const nextCompleted = adjusted_completed_at === null && "adjusted_completed_at" in body ? null : adjusted_completed_at ?? session.adjusted_completed_at;
  const effectiveArrival = nextArrival ?? session.arrival_recorded_at;
  const effectiveCompleted = nextCompleted ?? session.completed_recorded_at;
  if (effectiveArrival && effectiveCompleted && Date.parse(effectiveCompleted) < Date.parse(effectiveArrival)) {
    return json(req, { error: "invalid_range" }, 400);
  }

  const patch: Record<string, unknown> = { adjustment_reason: reason };
  if ("adjusted_arrival_at" in body) patch.adjusted_arrival_at = adjusted_arrival_at;
  if ("adjusted_completed_at" in body) patch.adjusted_completed_at = adjusted_completed_at;

  const { data, error } = await service.from("event_setup_sessions").update(patch).eq("id", session_id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);

  const { error: auditError } = await service.from("audit_logs").insert({
    event_id: session.event_id,
    entity_type: "SETUP_SESSION",
    entity_id: session_id,
    action: "UPDATE",
    actor_profile_id: callerId,
    before_data: {
      adjusted_arrival_at: session.adjusted_arrival_at,
      adjusted_completed_at: session.adjusted_completed_at,
      adjustment_reason: session.adjustment_reason,
    },
    after_data: {
      adjusted_arrival_at: data.adjusted_arrival_at,
      adjusted_completed_at: data.adjusted_completed_at,
      adjustment_reason: data.adjustment_reason,
    },
    reason,
  });
  if (auditError) return json(req, { error: auditError.message }, 400);
  return json(req, { session: { ...data, ...effectiveTimes(data) } });
}

async function signUpload(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const session_id = text(body.session_id);
  const photo_type = text(body.photo_type);
  const original_filename = text(body.original_filename) || "photo";
  const mime_type = text(body.mime_type);
  const file_size = Number(body.file_size ?? 0);
  if (!session_id || !PHOTO_TYPES.has(photo_type) || !ALLOWED_MIME.has(mime_type) || !Number.isFinite(file_size) || file_size <= 0 || file_size > MAX_BYTES) {
    return json(req, { error: "invalid_input" }, 400);
  }
  const session = await loadSession(service, session_id);
  if (!session || !(await canRead(service, session.event_id, callerId, isAdmin))) return json(req, { error: "not_found" }, 404);
  if (photo_type === "COMPLETION" && !session.arrival_recorded_at) return json(req, { error: "arrival_required" }, 409);

  const safe = original_filename.replace(/[/\\]/g, "").replace(/[^\w.\-가-힣]+/g, "_").slice(0, 80) || "photo";
  const storage_path = `${session.event_id}/${session_id}/${photo_type.toLowerCase()}/${crypto.randomUUID()}_${safe}`;
  const { data, error } = await service.storage.from("setup-photos").createSignedUploadUrl(storage_path);
  if (error || !data) return json(req, { error: error?.message || "sign_failed" }, 400);
  return json(req, { storage_path, token: data.token });
}

async function completeUpload(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const session_id = text(body.session_id);
  const storage_path = text(body.storage_path);
  const photo_type = text(body.photo_type);
  const note = text(body.note) || null;
  if (!session_id || !storage_path || !PHOTO_TYPES.has(photo_type)) return json(req, { error: "invalid_input" }, 400);
  const session = await loadSession(service, session_id);
  if (!session || !(await canRead(service, session.event_id, callerId, isAdmin))) return json(req, { error: "not_found" }, 404);
  if (!storage_path.startsWith(`${session.event_id}/${session_id}/`)) return json(req, { error: "invalid_path" }, 400);

  const recorded_at = new Date().toISOString();
  const { data: photo, error } = await service
    .from("event_setup_photos")
    .insert({
      setup_session_id: session_id,
      photo_type,
      storage_path,
      captured_by: callerId,
      recorded_at,
      note,
    })
    .select("*")
    .maybeSingle();
  if (error) return json(req, { error: error.message }, 400);

  const sessionPatch: Record<string, unknown> = {};
  if (photo_type === "ARRIVAL" && !session.arrival_recorded_at) {
    sessionPatch.arrival_recorded_at = recorded_at;
    sessionPatch.status = "ARRIVED";
  }
  if (photo_type === "COMPLETION") {
    if (!session.arrival_recorded_at && !sessionPatch.arrival_recorded_at) return json(req, { error: "arrival_required" }, 409);
    sessionPatch.completed_recorded_at = recorded_at;
    sessionPatch.status = "COMPLETED";
  }
  let next = session;
  if (Object.keys(sessionPatch).length) {
    const { data, error: sessionError } = await service.from("event_setup_sessions").update(sessionPatch).eq("id", session_id).select("*").maybeSingle();
    if (sessionError) return json(req, { error: sessionError.message }, 400);
    next = data;
  }
  return json(req, { photo, session: { ...next, ...effectiveTimes(next) } });
}

async function listLocations(req: Request, service: ReturnType<typeof secretClient>) {
  const { data, error } = await service.from("operation_locations").select("*").order("name");
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { locations: data ?? [] });
}

async function createLocation(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const name = text(body.name);
  const location_type = text(body.location_type);
  if (!name || !LOCATION_TYPES.has(location_type)) return json(req, { error: "invalid_input" }, 400);
  const { data, error } = await service
    .from("operation_locations")
    .insert({
      name,
      location_type,
      address: text(body.address) || null,
      latitude: body.latitude === null || body.latitude === "" || body.latitude === undefined ? null : Number(body.latitude),
      longitude: body.longitude === null || body.longitude === "" || body.longitude === undefined ? null : Number(body.longitude),
      memo: text(body.memo) || null,
      created_by: callerId,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return json(req, { error: "duplicate_name" }, 409);
    return json(req, { error: error.message }, 400);
  }
  return json(req, { location: data });
}

async function updateLocation(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const patch: Record<string, unknown> = {};
  if ("name" in body) patch.name = text(body.name);
  if ("location_type" in body) {
    const location_type = text(body.location_type);
    if (!LOCATION_TYPES.has(location_type)) return json(req, { error: "invalid_input" }, 400);
    patch.location_type = location_type;
  }
  if ("address" in body) patch.address = text(body.address) || null;
  if ("memo" in body) patch.memo = text(body.memo) || null;
  if ("is_active" in body) patch.is_active = Boolean(body.is_active);
  if ("latitude" in body) patch.latitude = body.latitude === null || body.latitude === "" ? null : Number(body.latitude);
  if ("longitude" in body) patch.longitude = body.longitude === null || body.longitude === "" ? null : Number(body.longitude);
  if (Object.keys(patch).length === 0) return json(req, { error: "invalid_input" }, 400);
  const { data, error } = await service.from("operation_locations").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_found" }, 404);
  return json(req, { location: data });
}

async function listTransitions(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const location_id = text(body.operation_location_id);
  let query = service.from("event_transition_legs").select("*").order("created_at");
  if (event_id) {
    if (!(await canRead(service, event_id, callerId, isAdmin))) return json(req, { error: "not_found" }, 404);
    query = query.or(`from_event_id.eq.${event_id},to_event_id.eq.${event_id}`);
  } else if (location_id) {
    if (!isAdmin) return json(req, { error: "forbidden" }, 403);
    query = query.or(`from_operation_location_id.eq.${location_id},to_operation_location_id.eq.${location_id}`);
  } else if (!isAdmin) {
    return json(req, { error: "forbidden" }, 403);
  }
  const { data, error } = await query;
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { transitions: data ?? [] });
}

function xorEndpoint(eventId: string, locationId: string) {
  return (Boolean(eventId) ? 1 : 0) + (Boolean(locationId) ? 1 : 0) === 1;
}

async function saveTransition(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const from_event_id = text(body.from_event_id) || null;
  const from_operation_location_id = text(body.from_operation_location_id) || null;
  const to_event_id = text(body.to_event_id) || null;
  const to_operation_location_id = text(body.to_operation_location_id) || null;
  const movement_subject = text(body.movement_subject);
  if (!xorEndpoint(from_event_id ?? "", from_operation_location_id ?? "") || !xorEndpoint(to_event_id ?? "", to_operation_location_id ?? "")) {
    return json(req, { error: "invalid_endpoint" }, 400);
  }
  if (!SUBJECTS.has(movement_subject)) return json(req, { error: "invalid_input" }, 400);
  if (from_event_id && to_event_id && from_event_id === to_event_id) return json(req, { error: "same_endpoint" }, 400);
  if (from_operation_location_id && to_operation_location_id && from_operation_location_id === to_operation_location_id) {
    return json(req, { error: "same_endpoint" }, 400);
  }

  const planned_departure_at = iso(body.planned_departure_at);
  const planned_arrival_at = iso(body.planned_arrival_at);
  const actual_departure_at = iso(body.actual_departure_at);
  const actual_arrival_at = iso(body.actual_arrival_at);
  if ([planned_departure_at, planned_arrival_at, actual_departure_at, actual_arrival_at].includes("invalid")) {
    return json(req, { error: "invalid_range" }, 400);
  }
  if (planned_departure_at && planned_arrival_at && Date.parse(planned_arrival_at) < Date.parse(planned_departure_at)) {
    return json(req, { error: "invalid_range" }, 400);
  }
  if (actual_departure_at && actual_arrival_at && Date.parse(actual_arrival_at) < Date.parse(actual_departure_at)) {
    return json(req, { error: "invalid_range" }, 400);
  }

  let planned_travel_minutes = int(body.planned_travel_minutes);
  const planned_buffer_minutes = int(body.planned_buffer_minutes);
  const staff_count = int(body.staff_count);
  for (const value of [planned_travel_minutes, planned_buffer_minutes, staff_count]) {
    if (Number.isNaN(value as number) || (value != null && value < 0)) return json(req, { error: "invalid_input" }, 400);
  }
  if (planned_travel_minutes == null && planned_departure_at && planned_arrival_at) {
    planned_travel_minutes = Math.round((Date.parse(planned_arrival_at) - Date.parse(planned_departure_at)) / 60000);
  }

  const row = {
    from_event_id,
    from_operation_location_id,
    to_event_id,
    to_operation_location_id,
    movement_subject,
    planned_departure_at,
    planned_arrival_at,
    planned_travel_minutes,
    planned_buffer_minutes,
    actual_departure_at,
    actual_arrival_at,
    staff_count,
    vehicle_note: text(body.vehicle_note) || null,
    note: text(body.note) || null,
    created_by: callerId,
  };

  const id = text(body.id);
  if (id) {
    const { created_by: _created, ...patch } = row;
    const { data, error } = await service.from("event_transition_legs").update(patch).eq("id", id).select("*").maybeSingle();
    if (error) return json(req, { error: error.message }, 400);
    if (!data) return json(req, { error: "not_found" }, 404);
    return json(req, { transition: data });
  }

  const { data, error } = await service.from("event_transition_legs").insert(row).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { transition: data });
}

async function saveTransitionActuals(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: current } = await service.from("event_transition_legs").select("*").eq("id", id).maybeSingle();
  if (!current) return json(req, { error: "not_found" }, 404);
  const fromOk = current.from_event_id ? await canRead(service, current.from_event_id, callerId, isAdmin) : false;
  const toOk = current.to_event_id ? await canRead(service, current.to_event_id, callerId, isAdmin) : false;
  if (!isAdmin && !fromOk && !toOk) return json(req, { error: "not_found" }, 404);

  const actual_departure_at = iso(body.actual_departure_at);
  const actual_arrival_at = iso(body.actual_arrival_at);
  if (actual_departure_at === "invalid" || actual_arrival_at === "invalid") return json(req, { error: "invalid_range" }, 400);
  const dep = "actual_departure_at" in body ? actual_departure_at : current.actual_departure_at;
  const arr = "actual_arrival_at" in body ? actual_arrival_at : current.actual_arrival_at;
  if (dep && arr && Date.parse(arr) < Date.parse(dep)) return json(req, { error: "invalid_range" }, 400);
  const patch: Record<string, unknown> = {};
  if ("actual_departure_at" in body) patch.actual_departure_at = actual_departure_at;
  if ("actual_arrival_at" in body) patch.actual_arrival_at = actual_arrival_at;
  if (Object.keys(patch).length === 0) return json(req, { error: "invalid_input" }, 400);
  const { data, error } = await service.from("event_transition_legs").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { transition: data });
}
