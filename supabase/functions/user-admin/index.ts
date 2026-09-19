import { json, preflight } from "../_shared/http.ts";
import { hasAppAccess, randomPassword, randomToken, sha256Hex } from "../_shared/crypto.ts";
import { normalizePhone, phoneToAuthEmail } from "../_shared/phone.ts";
import { callerUserId, secretClient } from "../_shared/supabase.ts";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Profile = {
  id: string;
  role: "ADMIN" | "STAFF" | "PART_TIMER";
  display_name: string;
  phone: string;
  is_master: boolean;
  is_active: boolean;
  login_allowed_from: string | null;
  login_allowed_until: string | null;
  created_at: string;
};

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
    if (!caller || caller.role !== "ADMIN" || !hasAppAccess(caller)) {
      return json(req, { error: "forbidden" }, 403);
    }

    const body = await req.json();
    const action = body?.action as string;

    if (action === "list") return json(req, await listUsers(service));
    if (action === "create") return await createUser(req, service, callerId, body);
    if (action === "update") return await updateUser(req, service, body);
    if (action === "revoke-invite") return await revokeInvite(req, service, body);
    if (action === "reissue-invite") return await reissueInvite(req, service, callerId, body);
    return json(req, { error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "server_error";
    return json(req, { error: message }, 500);
  }
});

async function requireAdminTargetGuard(profile: Profile | null) {
  if (!profile) throw new Error("not_found");
}

async function listUsers(service: ReturnType<typeof secretClient>) {
  const [{ data: profiles, error: pErr }, { data: invites, error: iErr }, auth] = await Promise.all([
    service.from("profiles").select("*").order("created_at", { ascending: false }),
    service.from("invites").select("*"),
    service.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  if (pErr) throw pErr;
  if (iErr) throw iErr;

  const lastSignIn = new Map((auth.data.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]));
  const now = Date.now();

  return {
    users: (profiles as Profile[]).map((profile) => {
      const mine = (invites ?? []).filter((row) => row.profile_id === profile.id);
      return {
        ...profile,
        last_sign_in_at: lastSignIn.get(profile.id) ?? null,
        invite_status: inviteStatus(mine, now),
        active_invite_id: mine.find((row) => isPending(row, now))?.id ?? null,
      };
    }),
  };
}

function isPending(row: { used_at: string | null; revoked_at: string | null; expires_at: string }, now: number) {
  return !row.used_at && !row.revoked_at && new Date(row.expires_at).getTime() > now;
}

function inviteStatus(
  rows: Array<{ used_at: string | null; revoked_at: string | null; expires_at: string }>,
  now: number,
) {
  if (rows.some((row) => isPending(row, now))) return "pending";
  if (rows.some((row) => row.used_at)) return "accepted";
  if (rows.some((row) => row.revoked_at && !row.used_at)) return "revoked";
  if (rows.some((row) => !row.used_at && !row.revoked_at && new Date(row.expires_at).getTime() <= now)) return "expired";
  return "none";
}

async function createInvite(service: ReturnType<typeof secretClient>, profileId: string, createdBy: string) {
  const token = randomToken();
  const token_hash = await sha256Hex(token);
  const { error } = await service.from("invites").insert({
    profile_id: profileId,
    token_hash,
    expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    created_by: createdBy,
  });
  if (error) throw error;
  return token;
}

async function revokeActiveInvites(service: ReturnType<typeof secretClient>, profileId: string) {
  const { error } = await service
    .from("invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .is("used_at", null)
    .is("revoked_at", null);
  if (error) throw error;
}

async function createUser(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const display_name = String(body.display_name ?? "").trim();
  const role = body.role as Profile["role"];
  const phone = normalizePhone(String(body.phone ?? ""));
  if (!display_name || !phone || !["ADMIN", "STAFF", "PART_TIMER"].includes(role)) {
    return json(req, { error: "invalid_input" }, 400);
  }

  const { data: existing } = await service.from("profiles").select("*").eq("phone", phone).maybeSingle();
  if (existing) {
    return json(req, { exists: true, profile: existing }, 200);
  }

  const { data: created, error: authError } = await service.auth.admin.createUser({
    email: phoneToAuthEmail(phone),
    password: randomPassword(),
    email_confirm: true,
    user_metadata: { display_name, phone },
  });
  if (authError || !created.user) {
    return json(req, { error: authError?.message ?? "auth_create_failed" }, 400);
  }

  const profileRow = {
    id: created.user.id,
    role,
    display_name,
    phone,
    is_master: false,
    is_active: false,
    login_allowed_from: body.login_allowed_from ?? null,
    login_allowed_until: body.login_allowed_until ?? null,
  };

  const { error: profileError } = await service.from("profiles").insert(profileRow);
  if (profileError) {
    await service.auth.admin.deleteUser(created.user.id);
    return json(req, { error: profileError.message }, 400);
  }

  const token = await createInvite(service, created.user.id, callerId);
  const origin = req.headers.get("Origin") || "https://app.ajumsocks.co.kr";
  return json(req, {
    exists: false,
    profile: profileRow,
    invite_url: `${origin}/invite/${token}`,
  });
}

async function updateUser(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const id = String(body.id ?? "");
  const { data: target, error } = await service.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  await requireAdminTargetGuard(target as Profile | null);
  if ((target as Profile).is_master) {
    return json(req, { error: "master_protected" }, 403);
  }
  if (body.phone) {
    return json(req, { error: "phone_change_not_supported" }, 400);
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.display_name === "string") patch.display_name = body.display_name.trim();
  if (body.role) patch.role = body.role;
  if ("is_active" in body) patch.is_active = Boolean(body.is_active);
  if ("login_allowed_from" in body) patch.login_allowed_from = body.login_allowed_from;
  if ("login_allowed_until" in body) patch.login_allowed_until = body.login_allowed_until;

  const { data, error: updErr } = await service.from("profiles").update(patch).eq("id", id).select("*").maybeSingle();
  if (updErr) return json(req, { error: updErr.message }, 400);
  return json(req, { profile: data });
}

async function revokeInvite(req: Request, service: ReturnType<typeof secretClient>, body: Record<string, unknown>) {
  const profileId = String(body.profile_id ?? "");
  await revokeActiveInvites(service, profileId);
  return json(req, { ok: true });
}

async function reissueInvite(
  req: Request,
  service: ReturnType<typeof secretClient>,
  callerId: string,
  body: Record<string, unknown>,
) {
  const profileId = String(body.profile_id ?? "");
  const { data: target } = await service.from("profiles").select("*").eq("id", profileId).maybeSingle();
  if (!target) return json(req, { error: "not_found" }, 404);
  if ((target as Profile).is_master) return json(req, { error: "master_protected" }, 403);

  await revokeActiveInvites(service, profileId);
  const token = await createInvite(service, profileId, callerId);
  const origin = req.headers.get("Origin") || "https://app.ajumsocks.co.kr";
  return json(req, { invite_url: `${origin}/invite/${token}` });
}
