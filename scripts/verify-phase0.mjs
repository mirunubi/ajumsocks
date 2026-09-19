import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { apiUrl, publishableKey, readStatusEnv, secretKey } from "./local-keys.mjs";

const PASSWORD = process.env.LOCAL_DEV_PASSWORD;
if (!PASSWORD || PASSWORD.length < 8) {
  console.error("Set LOCAL_DEV_PASSWORD (8+ characters). Do not commit it.");
  process.exit(1);
}

function client(key) {
  return createClient(apiUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(phone) {
  const supabase = client(publishableKey());
  const email = `${phone.replace(/\D/g, "")}@users.local.ajumsocks`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`${phone} login: ${error.message}`);
  return { supabase, session: data.session };
}

function hasAccess(profile) {
  if (!profile?.is_active) return false;
  const now = Date.now();
  if (profile.login_allowed_from && now < Date.parse(profile.login_allowed_from)) return false;
  if (profile.login_allowed_until && now > Date.parse(profile.login_allowed_until)) return false;
  return true;
}

async function expect(name, ok, extra = "") {
  if (!ok) throw new Error(`FAIL ${name}${extra ? `: ${extra}` : ""}`);
  console.log(`PASS ${name}`);
}

async function main() {
  const env = readStatusEnv();
  const publishable = client(publishableKey(env));
  const secret = secretKey(env);

  const signup = await publishable.auth.signUp({
    email: "uninvited@example.com",
    password: PASSWORD,
  });
  await expect("public signUp is rejected", Boolean(signup.error));

  const anonProfiles = await publishable.from("profiles").select("id");
  await expect(
    "unauthenticated cannot read profiles",
    Array.isArray(anonProfiles.data) ? anonProfiles.data.length === 0 : Boolean(anonProfiles.error),
  );

  const master = await signIn("+821000000001");
  const { data: masterProfile, error: masterProfileError } = await master.supabase
    .from("profiles")
    .select("*")
    .eq("id", master.session.user.id)
    .single();
  await expect("MASTER has app access", hasAccess(masterProfile) === true);
  await expect("MASTER can read own profile", !masterProfileError && masterProfile.is_master === true);
  const { data: allProfiles } = await master.supabase.from("profiles").select("id");
  await expect("MASTER can list profiles", (allProfiles || []).length >= 4);

  const demote = await master.supabase
    .from("profiles")
    .update({ is_active: false, role: "STAFF" })
    .eq("id", master.session.user.id)
    .select();
  await expect(
    "MASTER cannot deactivate/demote self via client",
    Boolean(demote.error) || (demote.data || []).length === 0,
    demote.error?.message,
  );
  await master.supabase.auth.signOut();

  const inactive = await signIn("+821000000003");
  const { data: inactiveProfile } = await inactive.supabase
    .from("profiles")
    .select("*")
    .eq("id", inactive.session.user.id)
    .single();
  await expect("inactive has no app access", hasAccess(inactiveProfile) === false);
  const { data: othersAsInactive } = await inactive.supabase
    .from("profiles")
    .select("id")
    .neq("id", inactive.session.user.id);
  await expect("inactive cannot read other profiles", (othersAsInactive || []).length === 0);
  await inactive.supabase.auth.signOut();

  const expired = await signIn("+821000000004");
  const { data: expiredProfile } = await expired.supabase
    .from("profiles")
    .select("*")
    .eq("id", expired.session.user.id)
    .single();
  await expect("expired window has no app access", hasAccess(expiredProfile) === false);
  await expired.supabase.auth.signOut();

  const jsFile = readdirSync("app/dist/assets").find((name) => name.endsWith(".js"));
  if (jsFile) {
    const bundle = readFileSync(`app/dist/assets/${jsFile}`, "utf8");
    await expect("bundle has no secret key", !bundle.includes(secret));
  }

  console.log("Phase 0 auth/RLS checks passed.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
