import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { apiUrl, publishableKey, secretKey } from "./local-keys.mjs";

const PASSWORD = process.env.LOCAL_DEV_PASSWORD;
if (!PASSWORD || PASSWORD.length < 8) {
  console.error("Set LOCAL_DEV_PASSWORD (8+ characters). Do not commit it.");
  process.exit(1);
}

function hasAccess(profile) {
  if (!profile?.is_active) return false;
  const now = Date.now();
  if (profile.login_allowed_from && now < Date.parse(profile.login_allowed_from)) return false;
  if (profile.login_allowed_until && now > Date.parse(profile.login_allowed_until)) return false;
  return true;
}

function client(key) {
  return createClient(apiUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(phone, password = PASSWORD) {
  const supabase = client(publishableKey());
  const email = `${phone.replace(/\D/g, "")}@users.local.ajumsocks`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${phone} login: ${error.message}`);
  return { supabase, session: data.session };
}

async function callFn(name, body, accessToken) {
  const key = publishableKey();
  const headers = {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${accessToken || key}`,
  };
  const res = await fetch(`${apiUrl()}/functions/v1/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function expect(name, ok, extra = "") {
  if (!ok) throw new Error(`FAIL ${name}${extra ? `: ${extra}` : ""}`);
  console.log(`PASS ${name}`);
}

async function main() {
  const publishable = client(publishableKey());
  const secret = client(secretKey());

  const signup = await publishable.auth.signUp({ email: "uninvited@example.com", password: PASSWORD });
  await expect("1 public signUp rejected", Boolean(signup.error));

  const master = await signIn("+821000000001");
  const listed = await callFn("user-admin", { action: "list" }, master.session.access_token);
  await expect("2 ADMIN can list users", listed.status === 200 && listed.json.users?.length >= 1, listed.json.error);

  const staff = await signIn("+821000000002");
  const staffList = await callFn("user-admin", { action: "list" }, staff.session.access_token);
  await expect("3 STAFF cannot list via admin function", staffList.status === 403);
  const { data: others } = await staff.supabase.from("profiles").select("id").neq("id", staff.session.user.id);
  await expect("3 STAFF cannot read other profiles", (others || []).length === 0);
  await staff.supabase.auth.signOut();

  const phone = "010-0000-9010";
  const created = await callFn(
    "user-admin",
    { action: "create", display_name: "테스트알바", phone, role: "PART_TIMER" },
    master.session.access_token,
  );
  await expect(
    "5 create auth+profile+invite",
    created.status === 200 && created.json.profile?.is_active === false && Boolean(created.json.invite_url),
    created.json.error,
  );
  const token = String(created.json.invite_url).split("/invite/")[1];

  const dup = await callFn(
    "user-admin",
    { action: "create", display_name: "중복", phone, role: "STAFF" },
    master.session.access_token,
  );
  await expect("4 duplicate phone returns exists", dup.json.exists === true);

  const { data: before } = await secret.from("profiles").select("*").eq("id", created.json.profile.id).single();
  await expect("6 invited user is_active false", before.is_active === false && !hasAccess(before));

  const short = await callFn("invite-accept", { action: "accept", token, password: "short" });
  await expect("11 password < 8 rejected", short.status === 400 && short.json.error === "password_too_short");

  const accepted = await callFn("invite-accept", { action: "accept", token, password: "InvitePass9" });
  await expect("7 invite accept succeeds", accepted.status === 200 && accepted.json.ok === true, accepted.json.error);

  const reuse = await callFn("invite-accept", { action: "accept", token, password: "InvitePass9" });
  await expect("8 invite reuse rejected", reuse.status === 400);

  const afterLogin = await signIn("+821000009010", "InvitePass9");
  const { data: afterProfile } = await afterLogin.supabase
    .from("profiles")
    .select("*")
    .eq("id", afterLogin.session.user.id)
    .single();
  await expect("12 login after accept", hasAccess(afterProfile));
  await afterLogin.supabase.auth.signOut();

  const expiredCreate = await callFn(
    "user-admin",
    { action: "create", display_name: "만료초대", phone: "010-0000-9011", role: "PART_TIMER" },
    master.session.access_token,
  );
  const expiredToken = String(expiredCreate.json.invite_url).split("/invite/")[1];
  await secret
    .from("invites")
    .update({ expires_at: "2020-01-01T00:00:00.000Z" })
    .eq("profile_id", expiredCreate.json.profile.id)
    .is("used_at", null);
  const expiredTry = await callFn("invite-accept", { action: "preview", token: expiredToken });
  await expect("9 expired invite rejected", expiredTry.status === 400 && expiredTry.json.error === "expired");

  const revokeCreate = await callFn(
    "user-admin",
    { action: "create", display_name: "취소초대", phone: "010-0000-9012", role: "PART_TIMER" },
    master.session.access_token,
  );
  const revokeToken = String(revokeCreate.json.invite_url).split("/invite/")[1];
  const revoked = await callFn(
    "user-admin",
    { action: "revoke-invite", profile_id: revokeCreate.json.profile.id },
    master.session.access_token,
  );
  await expect("10 revoke ok", revoked.status === 200);
  const revokeTry = await callFn("invite-accept", { action: "preview", token: revokeToken });
  await expect("10 revoked invite rejected", revokeTry.status === 400 && revokeTry.json.error === "revoked");

  const inactive = await signIn("+821000000003");
  const { data: inactiveProfile } = await inactive.supabase
    .from("profiles")
    .select("*")
    .eq("id", inactive.session.user.id)
    .single();
  await expect("13 inactive denied", !hasAccess(inactiveProfile));
  await inactive.supabase.auth.signOut();

  const futureCreate = await callFn(
    "user-admin",
    {
      action: "create",
      display_name: "미래알바",
      phone: "010-0000-9013",
      role: "PART_TIMER",
      login_allowed_from: "2099-01-01T00:00:00.000Z",
    },
    master.session.access_token,
  );
  const futureToken = String(futureCreate.json.invite_url).split("/invite/")[1];
  await callFn("invite-accept", { action: "accept", token: futureToken, password: "InvitePass9" });
  const futureLogin = await signIn("+821000009013", "InvitePass9");
  const { data: futureProfile } = await futureLogin.supabase
    .from("profiles")
    .select("*")
    .eq("id", futureLogin.session.user.id)
    .single();
  await expect("14 not-started denied", !hasAccess(futureProfile));
  await futureLogin.supabase.auth.signOut();

  const expiredUser = await signIn("+821000000004");
  const { data: expiredProfile } = await expiredUser.supabase
    .from("profiles")
    .select("*")
    .eq("id", expiredUser.session.user.id)
    .single();
  await expect("15 expired window denied", !hasAccess(expiredProfile));
  await expiredUser.supabase.auth.signOut();

  const masterPatch = await callFn(
    "user-admin",
    { action: "update", id: master.session.user.id, is_active: false, role: "STAFF" },
    master.session.access_token,
  );
  await expect("16 MASTER update rejected", masterPatch.status === 403);

  const jsFile = readdirSync("app/dist/assets").find((name) => name.endsWith(".js"));
  const bundle = readFileSync(`app/dist/assets/${jsFile}`, "utf8");
  await expect("17 bundle has no Secret Key", !bundle.includes(secretKey()));

  await master.supabase.auth.signOut();
  console.log("Phase 1 checks passed (reset/build reported separately).");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
