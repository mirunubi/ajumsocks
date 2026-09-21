import { createClient } from "@supabase/supabase-js";
import { apiUrl, publishableKey } from "./local-keys.mjs";

const PASSWORD = process.env.LOCAL_DEV_PASSWORD;
if (!PASSWORD || PASSWORD.length < 8) {
  console.error("Set LOCAL_DEV_PASSWORD (8+ characters). Do not commit it.");
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
  const checkId = process.argv[2];
  const leaveLast = Number(process.argv[3] ?? 1);
  if (!checkId) {
    console.error("Usage: node scripts/pilot-rehearsal-fill-check.mjs <check_id> [leaveLast=1]");
    process.exit(1);
  }
  const token = await signIn("+821000000001");
  const got = requireOk("get-check", await callFn("event-inventory", { action: "get-check", id: checkId }, token));
  const open = (got.items || []).filter((row) => row.remainder_level == null);
  const toFill = leaveLast > 0 ? open.slice(0, Math.max(0, open.length - leaveLast)) : open;
  console.log(`check ${checkId} status=${got.check?.status} items=${(got.items || []).length} open=${open.length} fill=${toFill.length} leave=${open.length - toFill.length}`);
  for (const item of toFill) {
    const saved = await callFn(
      "event-inventory",
      {
        action: "save-item",
        id: item.id,
        full_pack_count: 2,
        remainder_level: "FULL",
        updated_at: item.updated_at,
      },
      token,
    );
    if (saved.status !== 200) throw new Error(`save ${item.sku_code}: ${saved.status} ${saved.json.error}`);
  }
  const after = requireOk("get-check after", await callFn("event-inventory", { action: "get-check", id: checkId }, token));
  console.log(JSON.stringify({ unchecked: after.unchecked, total: (after.items || []).length, status: after.check?.status }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
