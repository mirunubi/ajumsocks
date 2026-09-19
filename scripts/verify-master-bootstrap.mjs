import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { apiUrl, publishableKey, secretKey } from "./local-keys.mjs";
import { normalizePhone, phoneToAuthEmail } from "./phone.mjs";

const phone = normalizePhone(process.env.MASTER_BOOTSTRAP_PHONE ?? "");
const password = process.env.MASTER_BOOTSTRAP_PASSWORD ?? "";
if (!phone || password.length < 8) {
  console.error("Set MASTER_BOOTSTRAP_PHONE and MASTER_BOOTSTRAP_PASSWORD for this check.");
  process.exit(1);
}

function expect(name, ok, extra = "") {
  if (!ok) throw new Error(`FAIL ${name}${extra ? `: ${extra}` : ""}`);
  console.log(`PASS ${name}`);
}

function secret() {
  return createClient(process.env.SUPABASE_URL || apiUrl(), process.env.SUPABASE_SECRET_KEY || secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function publishable() {
  return createClient(process.env.SUPABASE_URL || apiUrl(), publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function gitTrackedContains(needle) {
  let files = [];
  try {
    files = execSync("git ls-files", { encoding: "utf8", shell: true })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return false;
  }
  return files.some((file) => {
    try {
      return readFileSync(file, "utf8").includes(needle);
    } catch {
      return false;
    }
  });
}

async function main() {
  const admin = secret();

  execSync("node scripts/provision-master.mjs", { stdio: "inherit", shell: true, env: process.env });
  execSync("node scripts/provision-master.mjs", { stdio: "inherit", shell: true, env: process.env });

  const { data: masters, error } = await admin.from("profiles").select("*").eq("is_master", true);
  if (error) throw error;
  expect("single MASTER after re-run", (masters ?? []).length === 1);
  const master = masters[0];
  expect("role ADMIN", master.role === "ADMIN");
  expect("is_master true", master.is_master === true);
  expect("is_active true", master.is_active === true);
  expect("login_allowed_from NULL", master.login_allowed_from == null);
  expect("login_allowed_until NULL", master.login_allowed_until == null);
  expect("canonical phone", master.phone === phone);

  const { data: extraAuth, error: extraAuthError } = await admin.auth.admin.createUser({
    email: "second.master@users.local.ajumsocks",
    password: "UnusedPass9x",
    email_confirm: true,
  });
  if (extraAuthError || !extraAuth.user) throw extraAuthError ?? new Error("could not create extra auth user");
  const { error: secondMaster } = await admin.from("profiles").insert({
    id: extraAuth.user.id,
    role: "ADMIN",
    display_name: "second",
    phone: "+821099999999",
    is_master: true,
    is_active: true,
  });
  expect("second is_master rejected", Boolean(secondMaster));

  const client = publishable();
  const { data: sessionData, error: loginError } = await client.auth.signInWithPassword({
    email: phoneToAuthEmail(phone),
    password,
  });
  expect("MASTER login", !loginError && Boolean(sessionData.session));

  const demote = await client
    .from("profiles")
    .update({ is_active: false, role: "STAFF", is_master: false })
    .eq("id", master.id)
    .select();
  expect(
    "client cannot deactivate/demote MASTER",
    Boolean(demote.error) || (demote.data || []).length === 0,
  );

  const del = await client.from("profiles").delete().eq("id", master.id).select();
  expect("client cannot delete MASTER", Boolean(del.error) || (del.data || []).length === 0);

  const jsFile = readdirSync("app/dist/assets").find((name) => name.endsWith(".js"));
  const bundle = readFileSync(`app/dist/assets/${jsFile}`, "utf8");
  expect("bundle has no bootstrap password", !bundle.includes(password));
  expect("git has no bootstrap password", !gitTrackedContains(password));
  expect("git has no bootstrap phone input", !gitTrackedContains(process.env.MASTER_BOOTSTRAP_PHONE));
  expect("git has no canonical MASTER phone", !gitTrackedContains(phone));

  await client.auth.signOut();
  console.log("MASTER bootstrap checks passed.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
