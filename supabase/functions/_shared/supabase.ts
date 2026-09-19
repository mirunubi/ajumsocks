import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

function requireSecretKey(): string {
  const key =
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    throw new Error("SUPABASE_SECRET_KEY is required in the Edge Function runtime.");
  }
  if (key.startsWith("sb_publishable_")) {
    throw new Error("Publishable key cannot be used for admin operations.");
  }
  return key;
}

export function secretClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = requireSecretKey();
  if (!url) throw new Error("SUPABASE_URL is required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function callerUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return null;
  const { data, error } = await secretClient().auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user.id;
}
