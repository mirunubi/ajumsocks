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

type Category = { id: string; parent_id: string | null; name: string };
type Rule = {
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

type Candidate = {
  product_id: string;
  product_variant_id: string;
  product_code: string;
  product_name: string;
  sku_code: string;
  size_name: string | null;
  color_name: string | null;
  category_path: string;
  category_id: string | null;
  size_id: string | null;
  primary_color_id: string | null;
  tag_ids: string[];
};

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

    if (action === "get-event") return await getEvent(req, service, callerId, isAdmin, body);

    if (!isAdmin) return json(req, { error: "forbidden" }, 403);
    if (action === "list-sets") return await listSets(req, service);
    if (action === "get-set") return await getSet(req, service, body);
    if (action === "upsert-set") return await upsertSet(req, service, callerId, body);
    if (action === "add-rule") return await addRule(req, service, body);
    if (action === "update-rule") return await updateRule(req, service, body);
    if (action === "remove-rule") return await removeRule(req, service, body);
    if (action === "preview") return await preview(req, service, body);
    if (action === "apply-to-event") return await applyToEvent(req, service, callerId, body);
    if (action === "add-event-item") return await addEventItem(req, service, callerId, body);
    if (action === "remove-event-item") return await removeEventItem(req, service, callerId, body);
    if (action === "search-skus") return await searchSkus(req, service, body);
    return json(req, { error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "server_error";
    if (message.includes("assortment_exists")) return json(req, { error: "assortment_exists" }, 409);
    if (message.includes("empty_set")) return json(req, { error: "empty_set" }, 400);
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

function pgCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) return String((error as { code: string }).code);
  return "";
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

function descendantIds(categories: Category[], root: string, includeDescendants: boolean) {
  const ids = new Set<string>([root]);
  if (!includeDescendants) return ids;
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
  return ids;
}

function categoryPath(categories: Category[], id: string | null) {
  if (!id) return "";
  const byId = new Map(categories.map((cat) => [cat.id, cat]));
  const parts: string[] = [];
  let cursor: string | null = id;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const cat = byId.get(cursor);
    if (!cat) break;
    parts.unshift(cat.name);
    cursor = cat.parent_id;
  }
  return parts.join(" > ");
}

function ruleHasFilter(rule: Partial<Rule>) {
  return Boolean(
    rule.category_id || rule.tag_id || rule.size_id || rule.color_id || rule.product_id || rule.product_variant_id,
  );
}

function matchesRule(rule: Rule, candidate: Candidate, categories: Category[]) {
  if (rule.category_id) {
    const ids = descendantIds(categories, rule.category_id, rule.include_descendants);
    if (!candidate.category_id || !ids.has(candidate.category_id)) return false;
  }
  if (rule.tag_id && !candidate.tag_ids.includes(rule.tag_id)) return false;
  if (rule.size_id && candidate.size_id !== rule.size_id) return false;
  if (rule.color_id && candidate.primary_color_id !== rule.color_id) return false;
  if (rule.product_id && candidate.product_id !== rule.product_id) return false;
  if (rule.product_variant_id && candidate.product_variant_id !== rule.product_variant_id) return false;
  return true;
}

async function loadCandidates(service: ReturnType<typeof secretClient>, includeInactive = false) {
  const [{ data: products }, { data: variants }, { data: tags }, { data: categories }] = await Promise.all([
    service.from("products").select("id, product_code, name, primary_category_id, is_active"),
    service.from("product_variants").select("id, product_id, sku_code, size_id, primary_color_id, is_active, sizes(display_name), colors(name)"),
    service.from("product_tags").select("product_id, tag_id"),
    service.from("product_categories").select("id, parent_id, name"),
  ]);
  const cats = (categories ?? []) as Category[];
  const tagsByProduct = new Map<string, string[]>();
  for (const row of tags ?? []) {
    const list = tagsByProduct.get(row.product_id as string) ?? [];
    list.push(row.tag_id as string);
    tagsByProduct.set(row.product_id as string, list);
  }
  const productMap = new Map((products ?? []).map((row) => [row.id as string, row]));
  const candidates: Candidate[] = [];
  for (const variant of variants ?? []) {
    const product = productMap.get(variant.product_id as string);
    if (!product) continue;
    if (!includeInactive && (product.is_active === false || variant.is_active === false)) continue;
    const size = variant.sizes as { display_name?: string } | null;
    const color = variant.colors as { name?: string } | null;
    candidates.push({
      product_id: product.id as string,
      product_variant_id: variant.id as string,
      product_code: product.product_code as string,
      product_name: product.name as string,
      sku_code: variant.sku_code as string,
      size_name: size?.display_name ?? null,
      color_name: color?.name ?? null,
      category_path: categoryPath(cats, (product.primary_category_id as string | null) ?? null),
      category_id: (product.primary_category_id as string | null) ?? null,
      size_id: (variant.size_id as string | null) ?? null,
      primary_color_id: (variant.primary_color_id as string | null) ?? null,
      tag_ids: tagsByProduct.get(product.id as string) ?? [],
    });
  }
  return { candidates, categories: cats };
}

function evaluate(rules: Rule[], candidates: Candidate[], categories: Category[]) {
  const matched = new Map<string, Candidate & { source_rule_id: string }>();
  const sorted = [...rules].sort((a, b) => a.sort_order - b.sort_order);
  for (const rule of sorted) {
    for (const candidate of candidates) {
      if (matched.has(candidate.product_variant_id)) continue;
      if (matchesRule(rule, candidate, categories)) {
        matched.set(candidate.product_variant_id, { ...candidate, source_rule_id: rule.id });
      }
    }
  }
  return [...matched.values()];
}

function snapshotRow(row: Candidate & { source_rule_id?: string | null }, sourceType: "TEMPLATE" | "MANUAL", index: number) {
  return {
    product_id: row.product_id,
    product_variant_id: row.product_variant_id,
    source_rule_id: row.source_rule_id ?? null,
    source_type: sourceType,
    product_code_snapshot: row.product_code,
    product_name_snapshot: row.product_name,
    sku_code_snapshot: row.sku_code,
    size_snapshot: row.size_name,
    color_snapshot: row.color_name,
    category_snapshot: row.category_path || null,
    sort_order: index,
  };
}

async function listSets(req: Request, service: ReturnType<typeof secretClient>) {
  const [{ data: sets, error: setError }, { data: rules, error: ruleError }] = await Promise.all([
    service.from("assortment_sets").select("*").order("created_at", { ascending: false }),
    service.from("assortment_set_rules").select("*").order("sort_order"),
  ]);
  if (setError) return json(req, { error: setError.message }, 400);
  if (ruleError) return json(req, { error: ruleError.message }, 400);
  return json(req, { sets: sets ?? [], rules: rules ?? [] });
}

async function getSet(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: setRow } = await service.from("assortment_sets").select("*").eq("id", id).maybeSingle();
  if (!setRow) return json(req, { error: "not_found" }, 404);
  const { data: rules } = await service.from("assortment_set_rules").select("*").eq("assortment_set_id", id).order("sort_order");
  return json(req, { set: setRow, rules: rules ?? [] });
}

async function upsertSet(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const name = text(body.name);
  if (!name) return json(req, { error: "invalid_input" }, 400);
  const patch = {
    name,
    description: text(body.description) || null,
    is_active: body.is_active === false ? false : true,
  };
  const id = text(body.id);
  const writer = id
    ? service.from("assortment_sets").update(patch).eq("id", id)
    : service.from("assortment_sets").insert({ ...patch, created_by: callerId });
  const { data, error } = await writer.select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_found" }, 404);
  return json(req, { set: data });
}

function parseRule(body: Record<string, unknown>) {
  const rule = {
    category_id: uuidOrNull(body.category_id),
    include_descendants: body.include_descendants === false ? false : true,
    tag_id: uuidOrNull(body.tag_id),
    size_id: uuidOrNull(body.size_id),
    color_id: uuidOrNull(body.color_id),
    product_id: uuidOrNull(body.product_id),
    product_variant_id: uuidOrNull(body.product_variant_id),
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    memo: text(body.memo) || null,
  };
  if (!ruleHasFilter(rule)) return { error: "rule_empty" as const };
  return { rule };
}

async function addRule(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const assortment_set_id = text(body.assortment_set_id);
  if (!assortment_set_id) return json(req, { error: "invalid_input" }, 400);
  const parsed = parseRule(body);
  if ("error" in parsed) return json(req, { error: parsed.error }, 400);
  const { data, error } = await service
    .from("assortment_set_rules")
    .insert({ assortment_set_id, ...parsed.rule })
    .select("*")
    .maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { rule: data });
}

async function updateRule(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const parsed = parseRule(body);
  if ("error" in parsed) return json(req, { error: parsed.error }, 400);
  const { data, error } = await service.from("assortment_set_rules").update(parsed.rule).eq("id", id).select("*").maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_found" }, 404);
  return json(req, { rule: data });
}

async function removeRule(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { error } = await service.from("assortment_set_rules").delete().eq("id", id);
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { ok: true });
}

async function rulesForSet(service: ReturnType<typeof secretClient>, setId: string) {
  const { data: setRow } = await service.from("assortment_sets").select("*").eq("id", setId).maybeSingle();
  if (!setRow) return null;
  const { data: rules } = await service.from("assortment_set_rules").select("*").eq("assortment_set_id", setId).order("sort_order");
  return { set: setRow, rules: (rules ?? []) as Rule[] };
}

async function preview(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const assortment_set_id = text(body.assortment_set_id ?? body.id);
  if (!assortment_set_id) return json(req, { error: "invalid_input" }, 400);
  const loaded = await rulesForSet(service, assortment_set_id);
  if (!loaded) return json(req, { error: "not_found" }, 404);
  const { candidates, categories } = await loadCandidates(service);
  const skus = evaluate(loaded.rules, candidates, categories);
  return json(req, { sku_count: skus.length, skus });
}

async function applyToEvent(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const assortment_set_id = text(body.assortment_set_id);
  if (!event_id || !assortment_set_id) return json(req, { error: "invalid_input" }, 400);

  const { data: event } = await service.from("events").select("id").eq("id", event_id).maybeSingle();
  if (!event) return json(req, { error: "not_found" }, 404);

  const loaded = await rulesForSet(service, assortment_set_id);
  if (!loaded) return json(req, { error: "not_found" }, 404);
  const { candidates, categories } = await loadCandidates(service);
  const skus = evaluate(loaded.rules, candidates, categories);
  if (skus.length === 0) return json(req, { error: "empty_set" }, 400);

  const items = skus.map((row, index) => snapshotRow(row, "TEMPLATE", index));
  const { data, error } = await service.rpc("apply_event_assortment", {
    p_event_id: event_id,
    p_source_set_id: assortment_set_id,
    p_applied_by: callerId,
    p_items: items,
  });
  if (error) {
    const msg = error.message || "";
    if (msg.includes("assortment_exists")) return json(req, { error: "assortment_exists" }, 409);
    if (msg.includes("empty_set")) return json(req, { error: "empty_set" }, 400);
    if (pgCode(error) === "23505") return json(req, { error: "duplicate_sku" }, 409);
    return json(req, { error: error.message }, 400);
  }

  const payload = await eventRows(service, event_id);
  return json(req, { ...payload, applied: data });
}

async function eventRows(service: ReturnType<typeof secretClient>, eventId: string) {
  const [{ data: assortment }, { data: items }] = await Promise.all([
    service.from("event_assortments").select("*").eq("event_id", eventId).maybeSingle(),
    service.from("event_assortment_items").select("*").eq("event_id", eventId).order("sort_order").order("created_at"),
  ]);
  return { assortment, items: items ?? [] };
}

async function getEvent(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  if (!event_id) return json(req, { error: "invalid_input" }, 400);
  if (!(await canRead(service, event_id, callerId, isAdmin))) return json(req, { error: "not_found" }, 404);
  return json(req, await eventRows(service, event_id));
}

async function ensureHeader(
  service: ReturnType<typeof secretClient>,
  eventId: string,
  callerId: string,
) {
  const { data: existing } = await service.from("event_assortments").select("*").eq("event_id", eventId).maybeSingle();
  if (existing) return existing;
  const { data, error } = await service
    .from("event_assortments")
    .insert({ event_id: eventId, source_assortment_set_id: null, applied_by: callerId })
    .select("*")
    .maybeSingle();
  if (error) {
    if (pgCode(error) === "23505") {
      const { data: again } = await service.from("event_assortments").select("*").eq("event_id", eventId).maybeSingle();
      return again;
    }
    throw error;
  }
  return data;
}

async function addEventItem(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const product_variant_id = text(body.product_variant_id);
  if (!event_id || !product_variant_id) return json(req, { error: "invalid_input" }, 400);

  const header = await ensureHeader(service, event_id, callerId);
  if (!header) return json(req, { error: "create_failed" }, 500);

  const { data: existing } = await service
    .from("event_assortment_items")
    .select("*")
    .eq("event_assortment_id", header.id)
    .eq("product_variant_id", product_variant_id)
    .maybeSingle();
  if (existing && !existing.removed_at) return json(req, { error: "duplicate_sku" }, 409);

  const { candidates } = await loadCandidates(service, true);
  const found = candidates.find((row) => row.product_variant_id === product_variant_id);
  if (!found) return json(req, { error: "not_found" }, 404);

  if (existing?.removed_at) {
    const { data, error } = await service
      .from("event_assortment_items")
      .update({ removed_at: null, memo: text(body.memo) || existing.memo })
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    if (error) return json(req, { error: error.message }, 400);
    return json(req, { item: data });
  }

  const row = snapshotRow(found, "MANUAL", 900);
  const { data, error } = await service
    .from("event_assortment_items")
    .insert({
      ...row,
      event_assortment_id: header.id,
      event_id,
      created_by: callerId,
      memo: text(body.memo) || null,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    if (pgCode(error) === "23505") return json(req, { error: "duplicate_sku" }, 409);
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
    .from("event_assortment_items")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", id)
    .is("removed_at", null)
    .select("*")
    .maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  if (!data) return json(req, { error: "not_found" }, 404);
  return json(req, { item: data, updated_by: callerId });
}

async function searchSkus(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const q = text(body.q).toLowerCase();
  const { candidates } = await loadCandidates(service);
  const rows = q
    ? candidates.filter((row) =>
      row.product_name.toLowerCase().includes(q) ||
      row.product_code.toLowerCase().includes(q) ||
      row.sku_code.toLowerCase().includes(q)
    )
    : candidates;
  return json(req, { skus: rows.slice(0, 50), sku_count: rows.length });
}
