import { createClient } from "@supabase/supabase-js";
import { apiUrl, readStatusEnv, secretKey } from "./local-keys.mjs";

const LOCAL_DEV_PASSWORD = process.env.LOCAL_DEV_PASSWORD;
if (!LOCAL_DEV_PASSWORD || LOCAL_DEV_PASSWORD.length < 8) {
  console.error("Set LOCAL_DEV_PASSWORD (8+ characters) in the environment. Do not commit it.");
  process.exit(1);
}

const USERS = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    phone: "+821000000001",
    displayName: "로컬 MASTER",
    role: "ADMIN",
    isMaster: true,
    isActive: true,
    loginAllowedFrom: null,
    loginAllowedUntil: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    phone: "+821000000002",
    displayName: "로컬 직원",
    role: "STAFF",
    isMaster: false,
    isActive: true,
    loginAllowedFrom: null,
    loginAllowedUntil: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    phone: "+821000000003",
    displayName: "로컬 비활성",
    role: "PART_TIMER",
    isMaster: false,
    isActive: false,
    loginAllowedFrom: null,
    loginAllowedUntil: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    phone: "+821000000004",
    displayName: "로컬 기간만료",
    role: "PART_TIMER",
    isMaster: false,
    isActive: true,
    loginAllowedFrom: "2020-01-01T00:00:00.000Z",
    loginAllowedUntil: "2020-12-31T23:59:59.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    phone: "+821000000005",
    displayName: "로컬 알바",
    role: "PART_TIMER",
    isMaster: false,
    isActive: true,
    loginAllowedFrom: null,
    loginAllowedUntil: null,
  },
];

function adminClient() {
  const env = readStatusEnv();
  const url = apiUrl(env);
  const key = secretKey(env);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main() {
  const supabase = adminClient();

  for (const user of USERS) {
    const { error: createError } = await supabase.auth.admin.createUser({
      id: user.id,
      email: `${user.phone.replace(/\D/g, "")}@users.local.ajumsocks`,
      password: LOCAL_DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: user.displayName, phone: user.phone },
    });

    if (createError && !/already been registered|already exists/i.test(createError.message)) {
      throw new Error(`createUser ${user.phone}: ${createError.message}`);
    }

    const { error: upsertError } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        role: user.role,
        display_name: user.displayName,
        phone: user.phone,
        is_master: user.isMaster,
        is_active: user.isActive,
        login_allowed_from: user.loginAllowedFrom,
        login_allowed_until: user.loginAllowedUntil,
      },
      { onConflict: "id" },
    );

    if (upsertError) {
      throw new Error(`profile ${user.phone}: ${upsertError.message}`);
    }

    console.log(`provisioned ${user.role} ${user.phone} (${user.displayName})`);
  }

  console.log("local MASTER login: 010-0000-0001 / (LOCAL_DEV_PASSWORD)");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
