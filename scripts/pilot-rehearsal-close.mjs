import { createClient } from "@supabase/supabase-js";
import { apiUrl, publishableKey } from "./local-keys.mjs";

const PASSWORD = process.env.LOCAL_DEV_PASSWORD;
if (!PASSWORD || PASSWORD.length < 8) {
  console.error("Set LOCAL_DEV_PASSWORD (8+ characters). Do not commit it.");
  process.exit(1);
}

const EVENT_ID = process.argv[2];
if (!EVENT_ID) {
  console.error("Usage: node scripts/pilot-rehearsal-close.mjs <event_id>");
  process.exit(1);
}

function client(key) {
  return createClient(apiUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(phone) {
  const supabase = client(publishableKey());
  const email = `${phone.replace(/\D/g, "")}@users.local.ajumsocks`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`${phone} login: ${error.message}`);
  return data.session.access_token;
}

async function callFn(name, body, accessToken) {
  const key = publishableKey();
  const res = await fetch(`${apiUrl()}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${accessToken || key}`,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { error: raw.slice(0, 200) };
  }
  return { status: res.status, json: parsed };
}

function requireOk(label, result) {
  if (result.status !== 200) throw new Error(`${label}: ${result.status} ${result.json.error || JSON.stringify(result.json)}`);
  return result.json;
}

async function main() {
  const token = await signIn("+821000000001");
  const created = requireOk(
    "create CLOSING",
    await callFn("event-inventory", { action: "create-check", event_id: EVENT_ID, check_kind: "CLOSING", check_scope: "FULL" }, token),
  );
  const checkId = created.check.id;
  console.log(`closing check ${checkId} items=${(created.items || []).length}`);
  let items = created.items || [];
  for (const item of items) {
    const saved = await callFn(
      "event-inventory",
      {
        action: "save-item",
        id: item.id,
        full_pack_count: item.full_pack_count ?? 1,
        remainder_level: item.remainder_level ?? "HALF",
        updated_at: item.updated_at,
      },
      token,
    );
    if (saved.status !== 200) throw new Error(`save ${item.sku_code}: ${saved.status} ${saved.json.error}`);
  }
  const confirmed = requireOk("confirm CLOSING", await callFn("event-inventory", { action: "confirm-check", id: checkId }, token));
  console.log(JSON.stringify({ check_id: checkId, status: confirmed.check?.status }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
