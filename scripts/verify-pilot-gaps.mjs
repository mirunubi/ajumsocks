import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { apiUrl, publishableKey, secretKey } from "./local-keys.mjs";

const PASSWORD = process.env.LOCAL_DEV_PASSWORD;
if (!PASSWORD || PASSWORD.length < 8) {
  console.error("Set LOCAL_DEV_PASSWORD (8+ characters). Do not commit it.");
  process.exit(1);
}

function client(key) {
  return createClient(apiUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(phone, password = PASSWORD) {
  const supabase = client(publishableKey());
  const email = `${phone.replace(/\D/g, "")}@users.local.ajumsocks`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${phone} login: ${error.message}`);
  return { supabase, session: data.session, user: data.user };
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

async function expect(name, ok, extra = "") {
  if (!ok) throw new Error(`FAIL ${name}${extra ? `: ${extra}` : ""}`);
  console.log(`PASS ${name}`);
}

function isOpen(item) {
  return item.full_pack_count == null;
}

function filterLines(items, filter) {
  const q = (filter.query ?? "").trim().toLowerCase();
  return items.filter((item) => {
    if (filter.onlyOpen && !isOpen(item)) return false;
    if (filter.category && (item.category_name || "미분류") !== filter.category) return false;
    if (filter.size && item.size_name !== filter.size) return false;
    if (filter.color && item.color_name !== filter.color) return false;
    if (!q) return true;
    return (
      item.product_name.toLowerCase().includes(q) ||
      item.product_code.toLowerCase().includes(q) ||
      item.sku_code.toLowerCase().includes(q)
    );
  });
}

/** Must match app/src/lib/inventory.ts nextOpenInventoryItem. */
function nextOpenInventoryItem(items, savedId, filter) {
  const filtered = filterLines(items, filter);
  if (filtered.length === 0) return null;
  if (filter.onlyOpen) return filtered[0];
  const idx = filtered.findIndex((item) => item.id === savedId || item.product_variant_id === savedId);
  if (idx < 0) return filtered[0];
  return filtered[idx + 1] ?? null;
}

function oldSkipNext(items, savedIndex, onlyOpen) {
  const filtered = items.filter((item) => !(onlyOpen && item.full_pack_count != null));
  const nextIndex = Math.min(savedIndex + 1, Math.max(filtered.length - 1, 0));
  return filtered[nextIndex] ?? null;
}

function line(id, open) {
  return {
    id,
    product_variant_id: `v-${id}`,
    product_name: id,
    product_code: id,
    sku_code: id,
    full_pack_count: open ? null : 1,
    remainder_level: open ? null : "ZERO",
    category_name: "양말",
    size_name: "M",
    color_name: "BLACK",
  };
}

function stamp() {
  return Date.now();
}

async function main() {
  const screen = readFileSync("app/src/screens/EventInventoryCheckScreen.tsx", "utf8");
  const helper = readFileSync("app/src/lib/inventory.ts", "utf8");
  const edge = readFileSync("supabase/functions/event-admin/index.ts", "utf8");
  const detail = readFileSync("app/src/screens/EventDetailScreen.tsx", "utf8");

  await expect("P1-03 helper exists", /export function nextOpenInventoryItem/.test(helper));
  await expect("P1-03 screen uses stable currentId", screen.includes("currentId") && screen.includes("nextOpenInventoryItem"));
  await expect("P1-03 screen does not increment index after save", !screen.includes("setIndex") && !/index\s*\+\s*1/.test(screen));
  await expect("P1-03 remainder bands unchanged", helper.includes('id: "ZERO"') && helper.includes('id: "VERY_LOW"') && helper.includes('id: "HALF"') && helper.includes('id: "HIGH"') && helper.includes('id: "FULL"'));
  await expect("P1-02 remove-member in event-admin", edge.includes('action === "remove-member"') && edge.includes('.from("event_members")') && edge.includes(".delete()"));
  await expect("P1-02 no new is_active column on members", !/event_members[\s\S]{0,200}is_active/.test(edge));
  await expect("P1-01 detail uses existing update", detail.includes('action: "update"') && detail.includes("행사정보 수정") && detail.includes("EventBasicsFields"));
  await expect("P1-01 organizer change keeps snapshot copy", detail.includes("기존 Snapshot을 유지") && !detail.includes("copy_contact_ids"));
  await expect("P1-02 해제 UI + confirm", detail.includes("해제") && detail.includes("이 행사에서 해제하시겠습니까"));

  const onlyOpen = { onlyOpen: true };
  const abcOpen = [line("A", true), line("B", true), line("C", true)];
  const afterA = [line("A", false), line("B", true), line("C", true)];
  const afterAB = [line("A", false), line("B", false), line("C", true)];
  const afterAll = [line("A", false), line("B", false), line("C", false)];
  const aAndC = [line("A", false), line("B", true), line("C", false)];

  await expect("P1-03 old index+1 skipped B", oldSkipNext(afterA, 0, true)?.id === "C");
  await expect("P1-03 A save → B", nextOpenInventoryItem(afterA, "A", onlyOpen)?.id === "B");
  await expect("P1-03 B save → C", nextOpenInventoryItem(afterAB, "B", onlyOpen)?.id === "C");
  await expect("P1-03 C save → none", nextOpenInventoryItem(afterAll, "C", onlyOpen) == null);
  await expect("P1-03 partial A+C keeps B", nextOpenInventoryItem(aAndC, "A", onlyOpen)?.id === "B");
  await expect("P1-03 first remaining when onlyOpen", nextOpenInventoryItem(aAndC, "C", onlyOpen)?.id === "B");
  await expect(
    "P1-03 all-filter after A is B not C",
    nextOpenInventoryItem(afterA, "A", { onlyOpen: false })?.id === "B",
  );
  await expect("P1-03 never uses empty list as skip", nextOpenInventoryItem(abcOpen, "A", onlyOpen)?.id === "A");

  const master = await signIn("+821000000001");
  const staff = await signIn("+821000000002");
  const partTimer = await signIn("+821000000005");
  const token = master.session.access_token;
  const secret = client(secretKey());

  const orgA = await callFn(
    "organizer-admin",
    {
      action: "create",
      name: `P1주최A-${stamp()}`,
      calendar_color: "#7C3AED",
      default_contract_type: "COMMISSION",
      default_commission_rate: 18,
      memo: "A terms",
    },
    token,
  );
  await expect("P1-01 organizer A", orgA.status === 200, orgA.json.error);
  const orgB = await callFn(
    "organizer-admin",
    {
      action: "create",
      name: `P1주최B-${stamp()}`,
      calendar_color: "#2563EB",
      default_contract_type: "COMMISSION",
      default_commission_rate: 30,
      memo: "B terms",
    },
    token,
  );
  await expect("P1-01 organizer B", orgB.status === 200, orgB.json.error);
  const orgAId = orgA.json.organizer.id;
  const orgBId = orgB.json.organizer.id;

  const contactA = await callFn(
    "organizer-admin",
    { action: "add-contact", organizer_id: orgAId, contact_type: "HQ", name: "김스냅샷A", department: "영업" },
    token,
  );
  const contactB = await callFn(
    "organizer-admin",
    { action: "add-contact", organizer_id: orgBId, contact_type: "VENUE", name: "박스냅샷B", department: "운영" },
    token,
  );
  await expect("P1-01 contacts", contactA.status === 200 && contactB.status === 200, contactA.json.error || contactB.json.error);

  const created = await callFn(
    "event-admin",
    {
      action: "create",
      name: "P1 원본행사",
      organizer_id: orgAId,
      venue_name: "현대백화점 판교점",
      address: "경기도 성남시 분당구 판교역로 146",
      address_detail: "1층",
      starts_at: "2026-09-20T10:30:00+09:00",
      ends_at: "2026-09-25T20:00:00+09:00",
      status: "ACTIVE",
      contract_type: "COMMISSION",
      commission_rate: 18,
      contract_memo: "A snapshot memo",
      copy_contact_ids: [contactA.json.contact.id],
    },
    token,
  );
  await expect("P1-01 event create", created.status === 200, created.json.error);
  const eventId = created.json.event.id;

  const other = await callFn(
    "event-admin",
    {
      action: "create",
      name: "P1 다른행사",
      organizer_id: orgBId,
      venue_name: "수원",
      address: "경기도 수원시",
      starts_at: "2026-09-28T10:00:00+09:00",
      ends_at: "2026-10-03T20:00:00+09:00",
      status: "PREPARING",
      contract_type: "NONE",
    },
    token,
  );
  await expect("P1-02 other event", other.status === 200, other.json.error);
  const otherId = other.json.event.id;

  const addStaff = await callFn(
    "event-admin",
    { action: "add-member", event_id: eventId, profile_id: staff.user.id, assignment_role: "STAFF" },
    token,
  );
  const addPart = await callFn(
    "event-admin",
    { action: "add-member", event_id: eventId, profile_id: partTimer.user.id, assignment_role: "PART_TIMER" },
    token,
  );
  const addStaffOther = await callFn(
    "event-admin",
    { action: "add-member", event_id: otherId, profile_id: staff.user.id, assignment_role: "STAFF" },
    token,
  );
  await expect(
    "P1-02 members assigned",
    addStaff.status === 200 && addPart.status === 200 && addStaffOther.status === 200,
    addStaff.json.error || addPart.json.error || addStaffOther.json.error,
  );

  const staffRemove = await callFn(
    "event-admin",
    { action: "remove-member", event_id: eventId, profile_id: partTimer.user.id },
    staff.session.access_token,
  );
  const partRemove = await callFn(
    "event-admin",
    { action: "remove-member", event_id: eventId, profile_id: staff.user.id },
    partTimer.session.access_token,
  );
  await expect("P1-02 STAFF remove 거부", staffRemove.status === 403);
  await expect("P1-02 PART_TIMER remove 거부", partRemove.status === 403);

  const removed = await callFn(
    "event-admin",
    { action: "remove-member", event_id: eventId, profile_id: staff.user.id },
    token,
  );
  await expect("P1-02 ADMIN remove 성공", removed.status === 200 && removed.json.removed === true && removed.json.already_removed === false, removed.json.error);

  const dupRemove = await callFn(
    "event-admin",
    { action: "remove-member", event_id: eventId, profile_id: staff.user.id },
    token,
  );
  await expect("P1-02 duplicate remove 안전", dupRemove.status === 200 && dupRemove.json.already_removed === true, dupRemove.json.error);

  const staffMine = await staff.supabase.from("events").select("id").eq("id", eventId);
  const staffOther = await staff.supabase.from("events").select("id").eq("id", otherId);
  await expect("P1-02 해제 후 my-events에서 사라짐", (staffMine.data || []).length === 0);
  await expect("P1-02 다른 행사 배정 유지", (staffOther.data || []).length === 1);

  const staffDirect = await callFn("event-admin", { action: "get", id: eventId }, staff.session.access_token);
  await expect("P1-02 direct get 차단", staffDirect.status === 404 && staffDirect.json.error === "not_found");

  const staffInv = await callFn(
    "event-inventory",
    { action: "create-check", event_id: eventId, check_kind: "ROUTINE", check_scope: "FULL" },
    staff.session.access_token,
  );
  const staffFin = await callFn("event-finance", { action: "get-financial-summary", event_id: eventId }, staff.session.access_token);
  await expect("P1-02 inventory 접근 차단", staffInv.status === 403);
  await expect("P1-02 finance 접근 차단", staffFin.status === 403);

  const partStill = await callFn("event-admin", { action: "get", id: eventId }, partTimer.session.access_token);
  await expect("P1-02 PART_TIMER 배정 유지", partStill.status === 200, partStill.json.error);

  const readd = await callFn(
    "event-admin",
    { action: "add-member", event_id: eventId, profile_id: staff.user.id, assignment_role: "STAFF" },
    token,
  );
  await expect("P1-02 재배정 가능", readd.status === 200, readd.json.error);
  const staffBack = await callFn("event-admin", { action: "get", id: eventId }, staff.session.access_token);
  await expect("P1-02 재배정 후 접근 복구", staffBack.status === 200);

  const staffUpdate = await callFn("event-admin", { action: "update", id: eventId, name: "직원수정" }, staff.session.access_token);
  const partUpdate = await callFn("event-admin", { action: "update", id: eventId, name: "알바수정" }, partTimer.session.access_token);
  await expect("P1-01 STAFF update 거부", staffUpdate.status === 403);
  await expect("P1-01 PART_TIMER update 거부", partUpdate.status === 403);

  const renamed = await callFn(
    "event-admin",
    {
      action: "update",
      id: eventId,
      name: "P1 수정행사",
      venue_name: "롯데백화점 본점",
      address: "서울특별시 중구 남대문로 81",
      address_detail: "본관",
      starts_at: "2026-09-21T11:00:00+09:00",
      ends_at: "2026-09-26T21:30:00+09:00",
    },
    token,
  );
  await expect("P1-01 name/venue/address/datetime", renamed.status === 200 && renamed.json.event.name === "P1 수정행사", renamed.json.error);
  await expect("P1-01 venue", renamed.json.event.venue_name === "롯데백화점 본점");
  await expect("P1-01 address", renamed.json.event.address.includes("남대문로"));

  const contactsBefore = await secret.from("event_contacts").select("name, department").eq("event_id", eventId);
  const contractBefore = await secret
    .from("events")
    .select("commission_rate, contract_type, contract_memo, organizer_id")
    .eq("id", eventId)
    .single();
  const orgChange = await callFn("event-admin", { action: "update", id: eventId, organizer_id: orgBId }, token);
  await expect("P1-01 organizer 변경", orgChange.status === 200 && orgChange.json.event.organizer_id === orgBId, orgChange.json.error);
  await expect(
    "P1-01 organizer 변경 후 contract snapshot 유지",
    Number(orgChange.json.event.commission_rate) === Number(contractBefore.data.commission_rate) &&
      orgChange.json.event.contract_type === contractBefore.data.contract_type &&
      orgChange.json.event.contract_memo === contractBefore.data.contract_memo,
  );
  const contactsAfter = await secret.from("event_contacts").select("name, department").eq("event_id", eventId);
  await expect("P1-01 organizer 변경 후 contact snapshot 유지", (contactsAfter.data || []).length === (contactsBefore.data || []).length);
  await expect(
    "P1-01 contact still A",
    (contactsAfter.data || []).some((row) => row.name === "김스냅샷A") && !(contactsAfter.data || []).some((row) => row.name === "박스냅샷B"),
  );

  const sale = await callFn(
    "event-finance",
    {
      action: "save-daily-sales",
      event_id: eventId,
      business_date: "2026-09-21",
      card_amount: 1000000,
      cash_amount: 0,
      other_amount: 0,
    },
    token,
  );
  await expect("P1-01 sales for finance", sale.status === 200, sale.json.error);
  const beforeRate = await callFn("event-finance", { action: "get-financial-summary", event_id: eventId }, token);
  await expect("P1-01 finance uses 18% snapshot", Number(beforeRate.json.summary?.commission_amount) === 180000, JSON.stringify(beforeRate.json.summary));

  const contractEdit = await callFn(
    "event-admin",
    { action: "update", id: eventId, contract_type: "COMMISSION", commission_rate: 25, contract_memo: "정정" },
    token,
  );
  await expect("P1-01 event 계약 수정", contractEdit.status === 200 && Number(contractEdit.json.event.commission_rate) === 25, contractEdit.json.error);
  const orgTerms = await secret.from("event_organizer_terms").select("default_commission_rate").eq("organizer_id", orgBId).single();
  await expect("P1-01 organizer master terms 불변", Number(orgTerms.data.default_commission_rate) === 30);

  const afterRate = await callFn("event-finance", { action: "get-financial-summary", event_id: eventId }, token);
  await expect("P1-01 finance uses updated event snapshot", Number(afterRate.json.summary?.commission_amount) === 250000, JSON.stringify(afterRate.json.summary));

  const staffGet = await callFn("event-admin", { action: "get", id: eventId }, staff.session.access_token);
  await expect(
    "P1-01 STAFF financial protection",
    staffGet.status === 200 && !("commission_rate" in (staffGet.json.event || {})) && !("fixed_fee" in (staffGet.json.event || {})),
  );

  const cal = await callFn(
    "event-admin",
    { action: "calendar", from: "2026-09-01T00:00:00+09:00", to: "2026-09-30T23:59:59+09:00" },
    token,
  );
  const calEvent = (cal.json.events || []).find((row) => row.id === eventId);
  await expect("P1-01 calendar 반영", calEvent?.name === "P1 수정행사" && calEvent?.venue_name === "롯데백화점 본점");
  await expect("P1-01 calendar organizer B", calEvent?.organizer_id === orgBId);

  const detailGet = await callFn("event-admin", { action: "get", id: eventId }, token);
  await expect("P1-01 detail 반영", detailGet.json.event?.name === "P1 수정행사" && detailGet.json.organizer?.id === orgBId);

  const missingEvent = await callFn(
    "event-admin",
    { action: "remove-member", event_id: "00000000-0000-0000-0000-000000000000", profile_id: staff.user.id },
    token,
  );
  await expect("P1-02 missing event 404", missingEvent.status === 404);

  console.log("verify:pilot-gaps passed.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
