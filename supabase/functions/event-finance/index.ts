import { json, preflight } from "../_shared/http.ts";
import { hasAppAccess } from "../_shared/crypto.ts";
import { callerUserId, secretClient } from "../_shared/supabase.ts";

type Profile = {
  id: string;
  role: "ADMIN" | "STAFF" | "PART_TIMER";
  is_active: boolean;
  login_allowed_from: string | null;
  login_allowed_until: string | null;
};

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
    const { data: caller, error } = await service.from("profiles").select("*").eq("id", callerId).maybeSingle();
    if (error) throw error;
    if (!caller || !hasAppAccess(caller as Profile)) return json(req, { error: "forbidden" }, 403);

    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const isAdmin = caller.role === "ADMIN";

    if (action === "list-categories") return await listCategories(req, service);
    if (action === "upsert-category") return await requireAdmin(req, isAdmin, () => upsertCategory(req, service, body));
    if (action === "get-sales") return await getSales(req, service, callerId, isAdmin, body);
    if (action === "save-daily-sales") return await saveDailySales(req, service, callerId, isAdmin, body);
    if (action === "list-expenses") return await listExpenses(req, service, callerId, isAdmin, body);
    if (action === "create-expense") return await saveExpense(req, service, callerId, isAdmin, body, true);
    if (action === "update-expense") return await saveExpense(req, service, callerId, isAdmin, body, false);
    if (action === "void-expense") return await voidExpense(req, service, callerId, isAdmin, body);
    if (action === "sign-receipt-upload") return await signReceipt(req, service, callerId, isAdmin, body);
    if (action === "complete-receipt-upload") return await completeReceipt(req, service, callerId, isAdmin, body);
    if (action === "delete-receipt") return await deleteReceipt(req, service, isAdmin, body);
    if (action === "get-financial-summary") return await getSummary(req, service, callerId, isAdmin, body);
    if (action === "update-product-cost") return await requireAdmin(req, isAdmin, () => updateCost(req, service, callerId, body));
    if (action === "get-audit-log") return await requireAdmin(req, isAdmin, () => getAudit(req, service, body));
    if (action === "get-today-dashboard") return await requireAdmin(req, isAdmin, () => todayDashboard(req, service));
    return json(req, { error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "server_error";
    const mapped = mapError(message);
    return json(req, { error: mapped.error }, mapped.status);
  }
});

function mapError(message: string) {
  const keys = [
    "conflict",
    "date_out_of_range",
    "invalid_amount",
    "invalid_payment",
    "invalid_category",
    "invalid_input",
    "not_found",
    "voided",
    "already_voided",
    "upload_missing",
  ];
  for (const key of keys) {
    if (message.includes(key)) {
      const status = key === "conflict" ? 409 : key === "not_found" ? 404 : 400;
      return { error: key, status };
    }
  }
  if (message.includes("forbidden")) return { error: "forbidden", status: 403 };
  if (message.includes("duplicate") || message.includes("unique") || message.includes("23505")) {
    return { error: "conflict", status: 409 };
  }
  return { error: message, status: 500 };
}

function text(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

async function requireAdmin(req: Request, isAdmin: boolean, fn: () => Promise<Response>) {
  if (!isAdmin) return json(req, { error: "forbidden" }, 403);
  return await fn();
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

async function listCategories(req: Request, service: ReturnType<typeof secretClient>) {
  const { data, error } = await service.from("expense_categories").select("*").order("sort_order");
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { categories: data ?? [] });
}

async function upsertCategory(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const code = text(body.code).toUpperCase();
  const name = text(body.name);
  if (!code || !name) return json(req, { error: "invalid_input" }, 400);
  const { data, error } = await service
    .from("expense_categories")
    .upsert(
      {
        code,
        name,
        sort_order: Number(body.sort_order ?? 90),
        is_active: body.is_active === undefined ? true : Boolean(body.is_active),
      },
      { onConflict: "code" },
    )
    .select("*")
    .maybeSingle();
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { category: data });
}

async function getSales(
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
    .from("event_daily_sales")
    .select("*")
    .eq("event_id", event_id)
    .order("business_date");
  if (error) return json(req, { error: error.message }, 400);
  const { data: summary, error: sumError } = await service.rpc("event_finance_summary", { p_event_id: event_id });
  if (sumError) return json(req, { error: sumError.message }, 400);
  return json(req, { sales: data ?? [], days: (summary as { days?: unknown }).days ?? [] });
}

async function saveDailySales(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const denied = await requireEventAccess(req, service, event_id, callerId, isAdmin);
  if (denied) return denied;
  const { data, error } = await service.rpc("save_event_daily_sales", {
    p_event_id: event_id,
    p_business_date: text(body.business_date),
    p_card: body.card_amount,
    p_cash: body.cash_amount,
    p_other: body.other_amount,
    p_memo: text(body.memo) || null,
    p_expected_updated_at: body.updated_at ?? null,
    p_actor: callerId,
  });
  if (error) {
    const mapped = mapError(error.message);
    return json(req, { error: mapped.error }, mapped.status);
  }
  return json(req, { sale: data });
}

async function listExpenses(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const denied = await requireEventAccess(req, service, event_id, callerId, isAdmin);
  if (denied) return denied;
  const { data: expenses, error } = await service
    .from("event_expenses")
    .select("*")
    .eq("event_id", event_id)
    .order("expense_date", { ascending: false });
  if (error) return json(req, { error: error.message }, 400);
  const ids = (expenses ?? []).map((row) => row.id as string);
  const { data: receipts } = ids.length
    ? await service.from("event_expense_receipts").select("*").in("expense_id", ids)
    : { data: [] as Array<Record<string, unknown>> };
  const signed = await Promise.all(
    (receipts ?? []).map(async (row) => {
      const { data } = await service.storage.from("expense-receipts").createSignedUrl(row.storage_path as string, 3600);
      return { ...row, signed_url: data?.signedUrl ?? null };
    }),
  );
  const byExpense = new Map<string, Array<Record<string, unknown>>>();
  for (const row of signed) {
    const key = row.expense_id as string;
    const list = byExpense.get(key) ?? [];
    list.push(row);
    byExpense.set(key, list);
  }
  return json(req, {
    expenses: (expenses ?? []).map((row) => ({ ...row, receipts: byExpense.get(row.id as string) ?? [] })),
  });
}

async function saveExpense(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
  isCreate: boolean,
) {
  const event_id = text(body.event_id);
  const denied = await requireEventAccess(req, service, event_id, callerId, isAdmin);
  if (denied) return denied;
  const { data, error } = await service.rpc("save_event_expense", {
    p_id: isCreate ? null : text(body.id) || null,
    p_event_id: event_id,
    p_expense_date: text(body.expense_date),
    p_category_id: text(body.expense_category_id),
    p_amount: body.amount,
    p_payment_method: text(body.payment_method),
    p_description: text(body.description) || null,
    p_memo: text(body.memo) || null,
    p_expected_updated_at: body.updated_at ?? null,
    p_actor: callerId,
  });
  if (error) {
    const mapped = mapError(error.message);
    return json(req, { error: mapped.error }, mapped.status);
  }
  return json(req, { expense: data });
}

async function voidExpense(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  if (!isAdmin) return json(req, { error: "forbidden" }, 403);
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data, error } = await service.rpc("void_event_expense", { p_id: id, p_actor: callerId });
  if (error) {
    const mapped = mapError(error.message);
    return json(req, { error: mapped.error }, mapped.status);
  }
  return json(req, { expense: data });
}

function safeFilename(name: string) {
  const base = name.replace(/[/\\]/g, "").replace(/[^\w.\-가-힣]+/g, "_").slice(0, 80);
  return base || "receipt";
}

async function signReceipt(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const expense_id = text(body.expense_id);
  const mime_type = text(body.mime_type);
  const file_size = Number(body.file_size ?? 0);
  if (!event_id || !expense_id || !ALLOWED_MIME.has(mime_type) || !Number.isFinite(file_size) || file_size <= 0 || file_size > MAX_BYTES) {
    return json(req, { error: "invalid_input" }, 400);
  }
  const denied = await requireEventAccess(req, service, event_id, callerId, isAdmin);
  if (denied) return denied;
  const { data: expense } = await service.from("event_expenses").select("id, event_id").eq("id", expense_id).maybeSingle();
  if (!expense || expense.event_id !== event_id) return json(req, { error: "not_found" }, 404);
  const storage_path = `${event_id}/${expense_id}/${crypto.randomUUID()}_${safeFilename(text(body.original_filename) || "receipt")}`;
  const { data, error } = await service.storage.from("expense-receipts").createSignedUploadUrl(storage_path);
  if (error || !data) return json(req, { error: error?.message ?? "sign_failed" }, 400);
  return json(req, { storage_path, token: data.token, signed_url: data.signedUrl });
}

async function completeReceipt(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const expense_id = text(body.expense_id);
  const storage_path = text(body.storage_path);
  const mime_type = text(body.mime_type);
  const file_size = Number(body.file_size ?? 0);
  if (!event_id || !expense_id || !storage_path.startsWith(`${event_id}/${expense_id}/`)) {
    return json(req, { error: "invalid_input" }, 400);
  }
  if (!ALLOWED_MIME.has(mime_type) || !Number.isFinite(file_size) || file_size <= 0 || file_size > MAX_BYTES) {
    return json(req, { error: "invalid_input" }, 400);
  }
  const denied = await requireEventAccess(req, service, event_id, callerId, isAdmin);
  if (denied) return denied;
  const { data: objectInfo, error: headError } = await service.storage.from("expense-receipts").createSignedUrl(storage_path, 30);
  if (headError || !objectInfo?.signedUrl) return json(req, { error: "upload_missing" }, 400);
  const { data, error } = await service
    .from("event_expense_receipts")
    .insert({
      expense_id,
      event_id,
      storage_path,
      original_filename: text(body.original_filename) || "receipt",
      mime_type,
      file_size,
      uploaded_by: callerId,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    await service.storage.from("expense-receipts").remove([storage_path]);
    return json(req, { error: error.message }, 400);
  }
  const { data: signed } = await service.storage.from("expense-receipts").createSignedUrl(storage_path, 3600);
  return json(req, { receipt: { ...data, signed_url: signed?.signedUrl ?? null } });
}

async function deleteReceipt(req: Request, service: ReturnType<typeof secretClient>, isAdmin: boolean, body: Record<string, unknown>) {
  if (!isAdmin) return json(req, { error: "forbidden" }, 403);
  const id = text(body.id);
  if (!id) return json(req, { error: "invalid_input" }, 400);
  const { data: receipt } = await service.from("event_expense_receipts").select("*").eq("id", id).maybeSingle();
  if (!receipt) return json(req, { error: "not_found" }, 404);
  const { error: storageError } = await service.storage.from("expense-receipts").remove([receipt.storage_path]);
  if (storageError) return json(req, { error: "storage_delete_failed" }, 500);
  const { error } = await service.from("event_expense_receipts").delete().eq("id", id);
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { ok: true });
}

async function getSummary(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  const denied = await requireEventAccess(req, service, event_id, callerId, isAdmin);
  if (denied) return denied;
  const { data, error } = await service.rpc("event_finance_summary", { p_event_id: event_id });
  if (error) {
    const mapped = mapError(error.message);
    return json(req, { error: mapped.error }, mapped.status);
  }
  const summary = data as Record<string, unknown>;
  if (!isAdmin) {
    return json(req, {
      summary: {
        card_total: summary.card_total,
        cash_total: summary.cash_total,
        other_total: summary.other_total,
        sales_total: summary.sales_total,
        expense_total: summary.expense_total,
        days: summary.days,
      },
    });
  }
  return json(req, { summary });
}

async function updateCost(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const event_id = text(body.event_id);
  if (!event_id) return json(req, { error: "invalid_input" }, 400);
  const { data, error } = await service.rpc("save_event_product_cost", {
    p_event_id: event_id,
    p_cost: body.estimated_product_cost === undefined ? null : body.estimated_product_cost,
    p_memo: text(body.memo) || null,
    p_actor: callerId,
  });
  if (error) {
    const mapped = mapError(error.message);
    return json(req, { error: mapped.error }, mapped.status);
  }
  return json(req, { input: data });
}

async function getAudit(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const event_id = text(body.event_id);
  if (!event_id) return json(req, { error: "invalid_input" }, 400);
  const { data, error } = await service
    .from("audit_logs")
    .select("*")
    .eq("event_id", event_id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { logs: data ?? [] });
}

async function todayDashboard(req: Request, service: ReturnType<typeof secretClient>) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { data: events } = await service.from("events").select("id, name, starts_at, ends_at, status");
  const rows = [];
  for (const event of events ?? []) {
    const start = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(event.starts_at as string));
    const end = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(event.ends_at as string));
    if (today < start || today > end) continue;
    const { data: sale } = await service
      .from("event_daily_sales")
      .select("card_amount, cash_amount, other_amount")
      .eq("event_id", event.id)
      .eq("business_date", today)
      .maybeSingle();
    const total = sale ? Number(sale.card_amount) + Number(sale.cash_amount) + Number(sale.other_amount) : null;
    rows.push({ id: event.id, name: event.name, business_date: today, entered: Boolean(sale), total });
  }
  return json(req, { today, events: rows });
}
