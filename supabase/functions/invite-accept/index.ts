import { json, preflight } from "../_shared/http.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { maskDisplayName, maskPhone } from "../_shared/phone.ts";
import { secretClient } from "../_shared/supabase.ts";

type InviteRow = {
  id: string;
  profile_id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  try {
    const body = await req.json();
    const action = body?.action as string;
    const token = String(body?.token ?? "");
    if (!token) return json(req, { error: "invalid_token" }, 400);

    const invite = await loadInvite(token);
    if (!invite.ok) return json(req, { error: invite.error }, 400);

    if (action === "preview") {
      const profile = await loadProfile(invite.row.profile_id);
      return json(req, {
        display_name: maskDisplayName(profile.display_name),
        phone: maskPhone(profile.phone),
      });
    }

    if (action === "accept") {
      const password = String(body?.password ?? "");
      if (password.length < 8) return json(req, { error: "password_too_short" }, 400);

      const service = secretClient();
      const { error: pwError } = await service.auth.admin.updateUserById(invite.row.profile_id, { password });
      if (pwError) return json(req, { error: pwError.message }, 400);

      const { data: usedRows, error: usedError } = await service
        .from("invites")
        .update({ used_at: new Date().toISOString() })
        .eq("id", invite.row.id)
        .is("used_at", null)
        .is("revoked_at", null)
        .select("id");
      if (usedError) throw usedError;
      if (!usedRows?.length) return json(req, { error: "already_used" }, 400);

      const { error: activeError } = await service
        .from("profiles")
        .update({ is_active: true })
        .eq("id", invite.row.profile_id)
        .eq("is_master", false);
      if (activeError) throw activeError;

      return json(req, { ok: true, phone: (await loadProfile(invite.row.profile_id)).phone });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "server_error";
    return json(req, { error: message }, 500);
  }
});

async function loadInvite(token: string): Promise<{ ok: true; row: InviteRow } | { ok: false; error: string }> {
  const token_hash = await sha256Hex(token);
  const service = secretClient();
  const { data, error } = await service.from("invites").select("*").eq("token_hash", token_hash).maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "invalid_token" };
  if (data.used_at) return { ok: false, error: "already_used" };
  if (data.revoked_at) return { ok: false, error: "revoked" };
  if (new Date(data.expires_at).getTime() <= Date.now()) return { ok: false, error: "expired" };
  return { ok: true, row: data as InviteRow };
}

async function loadProfile(id: string) {
  const { data, error } = await secretClient().from("profiles").select("display_name, phone").eq("id", id).single();
  if (error || !data) throw new Error("not_found");
  return data;
}
