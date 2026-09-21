import { createClient } from "@supabase/supabase-js";
import { apiUrl, publishableKey } from "./local-keys.mjs";

const PASSWORD = process.env.LOCAL_DEV_PASSWORD;
const id = process.argv[2];
if (!PASSWORD || !id) {
  console.error("Usage: LOCAL_DEV_PASSWORD set; node scripts/pilot-rehearsal-recv.mjs <movement_id>");
  process.exit(1);
}

async function callFn(name, body, token) {
  const key = publishableKey();
  const res = await fetch(`${apiUrl()}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${token || key}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (res.status !== 200) throw new Error(`${body.action}: ${res.status} ${json.error}`);
  return json;
}

const supabase = createClient(apiUrl(), publishableKey(), { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await supabase.auth.signInWithPassword({
  email: "821000000001@users.local.ajumsocks",
  password: PASSWORD,
});
if (error) throw error;
const token = data.session.access_token;
const disp = await callFn("inventory-movement", { action: "dispatch", id }, token);
console.log("dispatch", disp.movement?.status);
const recv = await callFn("inventory-movement", { action: "receive", id, same_as_sent: true }, token);
console.log("receive", recv.movement?.status);
