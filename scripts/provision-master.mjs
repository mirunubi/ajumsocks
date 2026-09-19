import { createClient } from "@supabase/supabase-js";
import { apiUrl, secretKey } from "./local-keys.mjs";
import { maskPhone, normalizePhone, phoneToAuthEmail } from "./phone.mjs";

function requireBootstrapInput() {
  const phone = normalizePhone(process.env.MASTER_BOOTSTRAP_PHONE ?? "");
  const password = process.env.MASTER_BOOTSTRAP_PASSWORD ?? "";
  const displayName = (process.env.MASTER_BOOTSTRAP_DISPLAY_NAME ?? "MASTER").trim() || "MASTER";

  if (!phone) {
    console.error("Set MASTER_BOOTSTRAP_PHONE. Do not commit it.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Set MASTER_BOOTSTRAP_PASSWORD (8+ characters). Do not commit it.");
    process.exit(1);
  }
  return { phone, password, displayName };
}

function adminClient() {
  const url = process.env.SUPABASE_URL || apiUrl();
  const key = process.env.SUPABASE_SECRET_KEY || secretKey();
  if (key.startsWith("sb_publishable_")) {
    throw new Error("Publishable key cannot bootstrap MASTER.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function findAuthUserByEmail(supabase, email) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = (data.users ?? []).find((user) => user.email === email);
    if (found) return found;
    if ((data.users ?? []).length < 200) return null;
    page += 1;
  }
}

async function main() {
  const { phone, password, displayName } = requireBootstrapInput();
  const supabase = adminClient();
  const email = phoneToAuthEmail(phone);
  const masked = maskPhone(phone);

  const { data: existingMaster, error: masterError } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_master", true)
    .maybeSingle();
  if (masterError) throw masterError;

  if (existingMaster) {
    if (existingMaster.phone !== phone) {
      throw new Error("A MASTER profile already exists with a different phone. Refusing to create another.");
    }
    if (existingMaster.role !== "ADMIN" || existingMaster.is_active !== true) {
      throw new Error("Existing MASTER profile is not ADMIN/active. Refusing to auto-repair via bootstrap.");
    }
    console.log(`MASTER already present (${masked}). Idempotent skip.`);
    return;
  }

  const { data: existingPhone, error: phoneError } = await supabase
    .from("profiles")
    .select("id, is_master")
    .eq("phone", phone)
    .maybeSingle();
  if (phoneError) throw phoneError;
  if (existingPhone && !existingPhone.is_master) {
    throw new Error("Phone already belongs to a non-MASTER profile.");
  }

  let authUser = await findAuthUserByEmail(supabase, email);
  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, phone },
    });
    if (error || !data.user) throw new Error(error?.message ?? "auth create failed");
    authUser = data.user;
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: authUser.id,
    role: "ADMIN",
    display_name: displayName,
    phone,
    is_master: true,
    is_active: true,
    login_allowed_from: null,
    login_allowed_until: null,
  });
  if (profileError) throw new Error(profileError.message);

  console.log(`MASTER provisioned (${masked}). Change the bootstrap password after first login, then unset MASTER_BOOTSTRAP_PASSWORD.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
