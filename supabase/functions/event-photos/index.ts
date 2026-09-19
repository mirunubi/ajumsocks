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

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);
const MAX_BYTES = 10 * 1024 * 1024;

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

    if (action === "sign-upload") return await signUpload(req, service, callerId, isAdmin, body);
    if (action === "complete-upload") return await completeUpload(req, service, callerId, isAdmin, body);
    if (action === "delete") return await deletePhoto(req, service, isAdmin, body);
    return json(req, { error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "server_error";
    return json(req, { error: message }, 500);
  }
});

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

function safeFilename(name: string) {
  const base = name.replace(/[/\\]/g, "").replace(/[^\w.\-가-힣]+/g, "_").slice(0, 80);
  return base || "photo";
}

async function signUpload(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = String(body.event_id ?? "");
  const original_filename = String(body.original_filename ?? "photo");
  const mime_type = String(body.mime_type ?? "");
  const file_size = Number(body.file_size ?? 0);
  if (!event_id || !ALLOWED_MIME.has(mime_type) || !Number.isFinite(file_size) || file_size <= 0 || file_size > MAX_BYTES) {
    return json(req, { error: "invalid_input" }, 400);
  }
  if (!(await canRead(service, event_id, callerId, isAdmin))) {
    return json(req, { error: "forbidden" }, 403);
  }

  const { data: event } = await service.from("events").select("id").eq("id", event_id).maybeSingle();
  if (!event) return json(req, { error: "not_found" }, 404);

  const storage_path = `${event_id}/${crypto.randomUUID()}_${safeFilename(original_filename)}`;
  const { data, error } = await service.storage.from("event-photos").createSignedUploadUrl(storage_path);
  if (error || !data) return json(req, { error: error?.message ?? "sign_failed" }, 400);
  return json(req, {
    storage_path,
    token: data.token,
    signed_url: data.signedUrl,
  });
}

async function completeUpload(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  const event_id = String(body.event_id ?? "");
  const storage_path = String(body.storage_path ?? "");
  const original_filename = String(body.original_filename ?? "photo");
  const mime_type = String(body.mime_type ?? "");
  const file_size = Number(body.file_size ?? 0);
  if (!event_id || !storage_path.startsWith(`${event_id}/`)) {
    return json(req, { error: "invalid_input" }, 400);
  }
  if (!ALLOWED_MIME.has(mime_type) || !Number.isFinite(file_size) || file_size <= 0 || file_size > MAX_BYTES) {
    return json(req, { error: "invalid_input" }, 400);
  }
  if (!(await canRead(service, event_id, callerId, isAdmin))) {
    return json(req, { error: "forbidden" }, 403);
  }

  const { data: objectInfo, error: headError } = await service.storage
    .from("event-photos")
    .createSignedUrl(storage_path, 30);
  if (headError || !objectInfo?.signedUrl) {
    return json(req, { error: "upload_missing" }, 400);
  }

  const { data, error } = await service
    .from("event_photos")
    .insert({
      event_id,
      storage_path,
      original_filename,
      mime_type,
      file_size,
      caption: String(body.caption ?? "").trim() || null,
      photo_type: String(body.photo_type ?? "other").trim() || "other",
      uploaded_by: callerId,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    await service.storage.from("event-photos").remove([storage_path]);
    return json(req, { error: error.message }, 400);
  }

  const { data: signed } = await service.storage.from("event-photos").createSignedUrl(storage_path, 3600);
  return json(req, { photo: { ...data, signed_url: signed?.signedUrl ?? null } });
}

async function deletePhoto(
  req: Request,
  service: ReturnType<typeof secretClient>,
  isAdmin: boolean,
  body: Record<string, unknown>,
) {
  if (!isAdmin) return json(req, { error: "forbidden" }, 403);
  const id = String(body.id ?? "");
  if (!id) return json(req, { error: "invalid_input" }, 400);

  const { data: photo } = await service.from("event_photos").select("*").eq("id", id).maybeSingle();
  if (!photo) return json(req, { error: "not_found" }, 404);

  const { error: storageError } = await service.storage.from("event-photos").remove([photo.storage_path]);
  if (storageError) {
    return json(req, { error: "storage_delete_failed" }, 500);
  }

  const { error } = await service.from("event_photos").delete().eq("id", id);
  if (error) return json(req, { error: error.message }, 400);
  return json(req, { ok: true });
}
