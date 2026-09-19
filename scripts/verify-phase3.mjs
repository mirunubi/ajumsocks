import { readFileSync, readdirSync } from "node:fs";
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

function rank(status) {
  if (status === "RETURNED") return 3;
  if (status === "ON_SITE") return 2;
  if (status === "READY") return 1;
  return 0;
}

function progress(items) {
  const active = items.filter((item) => !item.removed_at);
  return {
    total: active.length,
    ready: active.filter((item) => rank(item.status) >= 1).length,
    onSite: active.filter((item) => rank(item.status) >= 2).length,
    returnTarget: active.filter((item) => item.requires_return).length,
    returned: active.filter((item) => item.requires_return && item.status === "RETURNED").length,
  };
}

async function main() {
  const publishable = client(publishableKey());
  const secret = client(secretKey());

  const signup = await publishable.auth.signUp({ email: "uninvited-p3@example.com", password: PASSWORD });
  await expect("22 public signUp rejected", Boolean(signup.error));

  const master = await signIn("+821000000001");
  const staff = await signIn("+821000000002");
  const partTimer = await signIn("+821000000005");

  const staffUsers = await callFn("user-admin", { action: "list" }, staff.session.access_token);
  await expect("22 STAFF user-admin forbidden", staffUsers.status === 403);

  const rack = await callFn(
    "prep-admin",
    { action: "upsert-item", name: "랙", item_type: "EQUIPMENT", default_unit: "개" },
    master.session.access_token,
  );
  await expect("1 ADMIN 준비물 생성 성공", rack.status === 200 && rack.json.item?.requires_return === true, rack.json.error);
  await expect("3 EQUIPMENT 생성", rack.json.item.item_type === "EQUIPMENT");

  const staffItem = await callFn(
    "prep-admin",
    { action: "upsert-item", name: "몰래등록", item_type: "CONSUMABLE" },
    staff.session.access_token,
  );
  await expect("2 STAFF 준비물 Master 생성 실패", staffItem.status === 403);
  const partItem = await callFn(
    "prep-admin",
    { action: "upsert-item", name: "몰래등록", item_type: "CONSUMABLE" },
    partTimer.session.access_token,
  );
  await expect("2 PART_TIMER 준비물 Master 생성 실패", partItem.status === 403);

  const bag = await callFn(
    "prep-admin",
    { action: "upsert-item", name: "쇼핑백", item_type: "CONSUMABLE", default_unit: "개" },
    master.session.access_token,
  );
  const light = await callFn(
    "prep-admin",
    { action: "upsert-item", name: "조명", item_type: "EQUIPMENT", default_unit: "세트" },
    master.session.access_token,
  );
  const cable = await callFn(
    "prep-admin",
    { action: "upsert-item", name: "USB 연장케이블", item_type: "EQUIPMENT", default_unit: "개" },
    master.session.access_token,
  );
  await expect("3 CONSUMABLE 생성", bag.status === 200 && bag.json.item?.requires_return === false, bag.json.error);

  const set = await callFn(
    "prep-admin",
    { action: "upsert-set", name: "백화점 기본세트", description: "판교/백화점" },
    master.session.access_token,
  );
  await expect("4 ADMIN 준비세트 생성 성공", set.status === 200 && Boolean(set.json.set?.id), set.json.error);
  const setId = set.json.set.id;

  const addRack = await callFn(
    "prep-admin",
    { action: "add-set-item", preparation_set_id: setId, preparation_item_id: rack.json.item.id, planned_quantity: 6 },
    master.session.access_token,
  );
  const addLight = await callFn(
    "prep-admin",
    { action: "add-set-item", preparation_set_id: setId, preparation_item_id: light.json.item.id, planned_quantity: 4 },
    master.session.access_token,
  );
  const addBag = await callFn(
    "prep-admin",
    { action: "add-set-item", preparation_set_id: setId, preparation_item_id: bag.json.item.id, planned_quantity: 300 },
    master.session.access_token,
  );
  await expect("5 세트에 준비물 여러 개 추가", addRack.status === 200 && addLight.status === 200 && addBag.status === 200);

  const dup = await callFn(
    "prep-admin",
    { action: "add-set-item", preparation_set_id: setId, preparation_item_id: rack.json.item.id, planned_quantity: 2 },
    master.session.access_token,
  );
  await expect("6 같은 항목 중복 추가 거부", dup.status === 409 && dup.json.error === "duplicate_item");

  const badQty = await callFn(
    "prep-admin",
    { action: "add-set-item", preparation_set_id: setId, preparation_item_id: cable.json.item.id, planned_quantity: 0 },
    master.session.access_token,
  );
  await expect("7 세트 수량 validation", badQty.status === 400 && badQty.json.error === "invalid_quantity");

  const event = await callFn(
    "event-admin",
    {
      action: "create",
      name: "판교 현대백화점 행사",
      venue_name: "현대백화점 판교점",
      address: "경기도 성남시 분당구 판교역로 146",
      starts_at: "2026-09-20T09:00:00+09:00",
      ends_at: "2026-09-25T21:00:00+09:00",
      status: "ACTIVE",
      contract_type: "NONE",
    },
    master.session.access_token,
  );
  const eventId = event.json.event.id;
  const other = await callFn(
    "event-admin",
    {
      action: "create",
      name: "수원 아울렛 행사",
      venue_name: "수원 롯데아울렛",
      address: "경기도 수원시",
      starts_at: "2026-09-28T10:00:00+09:00",
      ends_at: "2026-10-03T20:00:00+09:00",
      status: "PREPARING",
      contract_type: "NONE",
    },
    master.session.access_token,
  );
  const otherId = other.json.event.id;

  await callFn(
    "event-admin",
    { action: "add-member", event_id: eventId, profile_id: staff.user.id, assignment_role: "STAFF" },
    master.session.access_token,
  );
  await callFn(
    "event-admin",
    { action: "add-member", event_id: eventId, profile_id: partTimer.user.id, assignment_role: "PART_TIMER" },
    master.session.access_token,
  );

  const applied = await callFn(
    "prep-admin",
    { action: "apply-set", event_id: eventId, preparation_set_id: setId },
    master.session.access_token,
  );
  await expect("8 행사에 세트 적용 성공", applied.status === 200 && applied.json.items?.length === 3, applied.json.error);
  const snapRack = applied.json.items.find((row) => row.item_name_snapshot === "랙");
  await expect("9 Template 내용이 Snapshot으로 복사됨", Number(snapRack.planned_quantity) === 6);

  const reapply = await callFn(
    "prep-admin",
    { action: "apply-set", event_id: eventId, preparation_set_id: setId },
    master.session.access_token,
  );
  await expect("8 재적용 거부", reapply.status === 409 && reapply.json.error === "plan_exists");

  await callFn(
    "prep-admin",
    { action: "update-set-item", id: addRack.json.set_item.id, planned_quantity: 8 },
    master.session.access_token,
  );
  await callFn(
    "prep-admin",
    { action: "upsert-item", id: rack.json.item.id, name: "랙-변경", item_type: "EQUIPMENT", default_unit: "개" },
    master.session.access_token,
  );
  const afterTemplate = await staff.supabase.from("event_preparation_items").select("*").eq("id", snapRack.id).single();
  await expect(
    "10 Template 수정 후 기존 행사 Snapshot 불변",
    afterTemplate.data.item_name_snapshot === "랙" && Number(afterTemplate.data.planned_quantity) === 6,
  );

  const qtyPatch = await callFn(
    "prep-admin",
    { action: "update-event-item", id: snapRack.id, planned_quantity: 4 },
    master.session.access_token,
  );
  await expect("11 행사별 수량 수정", qtyPatch.status === 200 && Number(qtyPatch.json.item.planned_quantity) === 4);
  const templateLine = await secret.from("preparation_set_items").select("*").eq("id", addRack.json.set_item.id).single();
  await expect("11 행사별 수량 수정 시 Template 불변", Number(templateLine.data.planned_quantity) === 8);

  const added = await callFn(
    "prep-admin",
    { action: "add-event-item", event_id: eventId, preparation_item_id: cable.json.item.id, planned_quantity: 2 },
    master.session.access_token,
  );
  await expect("12 행사별 준비물 추가", added.status === 200 && added.json.item.item_name_snapshot === "USB 연장케이블", added.json.error);

  const removed = await callFn(
    "prep-admin",
    { action: "remove-event-item", id: added.json.item.id },
    master.session.access_token,
  );
  await expect("13 행사별 준비물 제외", removed.status === 200 && Boolean(removed.json.item.removed_at));

  const staffRows = await staff.supabase.from("event_preparation_items").select("*").eq("event_id", eventId);
  await expect("14 배정 STAFF 준비물 조회 성공", (staffRows.data || []).filter((row) => !row.removed_at).length === 3);

  const partRows = await partTimer.supabase.from("event_preparation_items").select("id").eq("event_id", eventId);
  await expect("15 배정 PART_TIMER 조회 성공", (partRows.data || []).length >= 3);

  const otherApply = await callFn(
    "prep-admin",
    { action: "apply-set", event_id: otherId, preparation_set_id: setId },
    master.session.access_token,
  );
  await expect("16 다른 행사 세트 적용", otherApply.status === 200, otherApply.json.error);
  const staffOther = await staff.supabase.from("event_preparation_items").select("id").eq("event_id", otherId);
  await expect("16 미배정 행사 준비물 조회 실패", (staffOther.data || []).length === 0);
  const staffGetOther = await callFn("prep-admin", { action: "get-event", event_id: otherId }, staff.session.access_token);
  await expect("16 미배정 get-event 실패", staffGetOther.status === 404);

  const snapBag = applied.json.items.find((row) => row.item_name_snapshot === "쇼핑백");
  const snapLight = applied.json.items.find((row) => row.item_name_snapshot === "조명");

  const staffReady = await callFn(
    "prep-admin",
    { action: "set-status", id: snapRack.id, status: "READY" },
    staff.session.access_token,
  );
  await expect("17 배정 STAFF 상태변경 성공", staffReady.status === 200 && staffReady.json.item.status === "READY", staffReady.json.error);

  const otherItem = otherApply.json.items[0];
  const staffOtherStatus = await callFn(
    "prep-admin",
    { action: "set-status", id: otherItem.id, status: "READY" },
    staff.session.access_token,
  );
  await expect("18 다른 행사 상태변경 실패", staffOtherStatus.status === 403);

  const bagReturn = await callFn(
    "prep-admin",
    { action: "set-status", id: snapBag.id, status: "RETURNED" },
    master.session.access_token,
  );
  await expect("19 소모품은 회수완료 미강제", bagReturn.status === 400 && bagReturn.json.error === "return_not_required");
  await callFn("prep-admin", { action: "set-status", id: snapBag.id, status: "ON_SITE" }, staff.session.access_token);
  await callFn("prep-admin", { action: "set-status", id: snapLight.id, status: "RETURNED" }, master.session.access_token);

  const live = await staff.supabase.from("event_preparation_items").select("*").eq("event_id", eventId);
  const stats = progress(live.data || []);
  await expect("20 집기는 회수대상 진행률에 포함", stats.returnTarget === 2 && stats.returned === 1);
  await expect("21 준비 진행률 계산 검증", stats.total === 3 && stats.ready === 3 && stats.onSite === 2, JSON.stringify(stats));

  const jsFile = readdirSync("app/dist/assets").find((name) => name.endsWith(".js"));
  const bundle = readFileSync(`app/dist/assets/${jsFile}`, "utf8");
  await expect("25 Client bundle에 Secret Key 없음", !bundle.includes(secretKey()));

  await master.supabase.auth.signOut();
  await staff.supabase.auth.signOut();
  await partTimer.supabase.auth.signOut();
  console.log("Phase 3 checks passed (reset/build reported separately).");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
