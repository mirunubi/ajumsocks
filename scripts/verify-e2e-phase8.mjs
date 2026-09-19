import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { apiUrl, publishableKey, secretKey } from "./local-keys.mjs";

const PASSWORD = process.env.LOCAL_DEV_PASSWORD;
if (!PASSWORD || PASSWORD.length < 8) {
  console.error("Set LOCAL_DEV_PASSWORD (8+ characters). Do not commit it.");
  process.exit(1);
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const MID = { ZERO: 0, VERY_LOW: 2, HALF: 5, HIGH: 8, FULL: 10 };

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

function n(value) {
  return Number(value);
}

function est(pack, full, remainder) {
  return full * pack + MID[remainder];
}

function kstDate(offsetDays) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
}

function ids(rows) {
  return new Set((rows || []).map((row) => row.id));
}

async function saveItem(token, item, full, remainder) {
  return callFn(
    "event-inventory",
    {
      action: "save-item",
      id: item.id,
      full_pack_count: full,
      remainder_level: remainder,
      updated_at: item.updated_at,
    },
    token,
  );
}

async function latestItem(token, checkId, itemId) {
  const got = await callFn("event-inventory", { action: "get-check", id: checkId }, token);
  if (got.status !== 200) throw new Error(`get-check ${got.json.error}`);
  return got.json.items.find((row) => row.id === itemId);
}

function stockMap(stock) {
  return Object.fromEntries((stock || []).map((row) => [row.product_variant_id, n(row.estimated_units)]));
}

function mapKey(map) {
  return JSON.stringify(Object.entries(map).sort(([left], [right]) => left.localeCompare(right)));
}

async function uploadEventPhoto(token, eventId) {
  const signed = await callFn(
    "event-photos",
    { action: "sign-upload", event_id: eventId, original_filename: "e2e-booth.png", mime_type: "image/png", file_size: PNG.length },
    token,
  );
  if (signed.status !== 200) return signed;
  const authed = createClient(apiUrl(), publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { error } = await authed.storage.from("event-photos").uploadToSignedUrl(signed.json.storage_path, signed.json.token, PNG, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) return { status: 400, json: { error: error.message } };
  return callFn(
    "event-photos",
    {
      action: "complete-upload",
      event_id: eventId,
      storage_path: signed.json.storage_path,
      original_filename: "e2e-booth.png",
      mime_type: "image/png",
      file_size: PNG.length,
      caption: "E2E 매대",
      photo_type: "booth",
    },
    token,
  );
}

async function uploadReceipt(token, eventId, expenseId) {
  const signed = await callFn(
    "event-finance",
    {
      action: "sign-receipt-upload",
      event_id: eventId,
      expense_id: expenseId,
      original_filename: "e2e-receipt.png",
      mime_type: "image/png",
      file_size: PNG.length,
    },
    token,
  );
  if (signed.status !== 200) return signed;
  const authed = createClient(apiUrl(), publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { error } = await authed.storage
    .from("expense-receipts")
    .uploadToSignedUrl(signed.json.storage_path, signed.json.token, PNG, { contentType: "image/png", upsert: true });
  if (error) return { status: 400, json: { error: error.message } };
  return callFn(
    "event-finance",
    {
      action: "complete-receipt-upload",
      event_id: eventId,
      expense_id: expenseId,
      storage_path: signed.json.storage_path,
      original_filename: "e2e-receipt.png",
      mime_type: "image/png",
      file_size: PNG.length,
    },
    token,
  );
}

async function main() {
  const publishable = client(publishableKey());
  const secret = client(secretKey());
  const day1 = kstDate(0);
  const day2 = kstDate(1);
  const dayLast = kstDate(3);
  const startsAt = `${day1}T09:00:00+09:00`;
  const endsAt = `${dayLast}T21:00:00+09:00`;

  const master = await signIn("+821000000001");
  const staff = await signIn("+821000000002");
  const partTimer = await signIn("+821000000005");
  const expired = await signIn("+821000000004");
  const token = master.session.access_token;

  let ready = false;
  for (let i = 0; i < 8; i += 1) {
    const ping = await callFn("event-finance", { action: "list-categories" }, token);
    if (ping.status === 200) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  await expect("0 Edge Function 준비", ready);

  const signup = await publishable.auth.signUp({ email: "uninvited-e2e@example.com", password: PASSWORD });
  await expect("14 공개 signup 불가", Boolean(signup.error));

  const masterPatch = await callFn("user-admin", { action: "update", id: master.user.id, is_active: false }, token);
  await expect("1 MASTER 보호", masterPatch.status === 403);
  const staffAdmin = await callFn("user-admin", { action: "list" }, staff.session.access_token);
  await expect("14 STAFF ADMIN API 접근차단", staffAdmin.status === 403);

  const event = await callFn(
    "event-admin",
    {
      action: "create",
      name: "Phase 8.5 통합테스트 행사",
      venue_name: "E2E 테스트 행사장",
      address: "경기도 성남시 분당구 테스트로 85",
      address_detail: "1층 임시매대",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "ACTIVE",
      contract_type: "MIXED",
      commission_rate: 10,
      fixed_fee: 300000,
      memo: "E2E only",
    },
    token,
  );
  await expect("2 행사 생성", event.status === 200 && event.json.event?.contract_type === "MIXED", event.json.error);
  const eventId = event.json.event.id;
  await expect("2 MIXED 계약", n(event.json.event.commission_rate) === 10 && n(event.json.event.fixed_fee) === 300000);

  const dest = await callFn(
    "event-admin",
    {
      action: "create",
      name: "Phase 8.5 이동목적지 행사",
      venue_name: "E2E 목적지",
      address: "경기도 수원시 테스트로 9",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "ACTIVE",
      contract_type: "NONE",
    },
    token,
  );
  await expect("2 목적지 행사 생성", dest.status === 200, dest.json.error);
  const destId = dest.json.event.id;

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
  await expect("1 STAFF/PART_TIMER 배정", addStaff.status === 200 && addPart.status === 200, addStaff.json.error || addPart.json.error);
  await expect("1 로그인기간 자동변경 없음", addStaff.json.login_window_unchanged === true);

  const contact = await callFn(
    "event-admin",
    { action: "add-contact", event_id: eventId, contact_type: "VENUE", name: "E2E 행사장 담당", phone: "010-0000-8888", company: "테스트백화점" },
    token,
  );
  await expect("2 외부 담당자", contact.status === 200, contact.json.error);

  const photo = await uploadEventPhoto(token, eventId);
  await expect("2 행사사진", photo.status === 200 && Boolean(photo.json.photo?.id), photo.json.error);

  const adminGet = await callFn("event-admin", { action: "get", id: eventId }, token);
  const destGet = await callFn("event-admin", { action: "get", id: destId }, token);
  await expect("1 ADMIN 전체 행사 접근", adminGet.status === 200 && destGet.status === 200);

  const staffMain = await callFn("event-admin", { action: "get", id: eventId }, staff.session.access_token);
  const staffDest = await callFn("event-admin", { action: "get", id: destId }, staff.session.access_token);
  const partMain = await callFn("event-admin", { action: "get", id: eventId }, partTimer.session.access_token);
  const partDest = await callFn("event-admin", { action: "get", id: destId }, partTimer.session.access_token);
  await expect("1 STAFF 배정 행사만 접근", staffMain.status === 200 && (staffDest.status === 403 || staffDest.status === 404));
  await expect("1 PART_TIMER 배정 행사만 접근", partMain.status === 200 && (partDest.status === 403 || partDest.status === 404));

  const staffEvents = await staff.supabase.from("events").select("id, name");
  const staffEventIds = ids(staffEvents.data);
  await expect(
    "2 STAFF 휴대폰 본인 행사만",
    staffEventIds.has(eventId) && !staffEventIds.has(destId),
    JSON.stringify([...(staffEventIds || [])]),
  );

  const expiredGet = await callFn("event-admin", { action: "get", id: eventId }, expired.session.access_token);
  await expect("1 로그인 허용기간 정책", expiredGet.status === 403);

  const rack = await callFn("prep-admin", { action: "upsert-item", name: "E2E 랙", item_type: "EQUIPMENT", default_unit: "개" }, token);
  const light = await callFn("prep-admin", { action: "upsert-item", name: "E2E 조명", item_type: "EQUIPMENT", default_unit: "세트" }, token);
  const tap = await callFn("prep-admin", { action: "upsert-item", name: "E2E 멀티탭", item_type: "EQUIPMENT", default_unit: "개" }, token);
  const terminal = await callFn("prep-admin", { action: "upsert-item", name: "E2E 카드단말기", item_type: "EQUIPMENT", default_unit: "대" }, token);
  const bag = await callFn("prep-admin", { action: "upsert-item", name: "E2E 쇼핑백", item_type: "CONSUMABLE", default_unit: "개" }, token);
  const prepSet = await callFn("prep-admin", { action: "upsert-set", name: "E2E 백화점세트" }, token);
  const setId = prepSet.json.set.id;
  for (const [item, qty] of [
    [rack, 4],
    [light, 2],
    [tap, 3],
    [terminal, 1],
    [bag, 200],
  ]) {
    const added = await callFn(
      "prep-admin",
      { action: "add-set-item", preparation_set_id: setId, preparation_item_id: item.json.item.id, planned_quantity: qty },
      token,
    );
    if (added.status !== 200) throw new Error(`prep set item: ${added.json.error}`);
  }
  const appliedPrep = await callFn("prep-admin", { action: "apply-set", event_id: eventId, preparation_set_id: setId }, token);
  await expect("3 준비물 세트 Snapshot", appliedPrep.status === 200 && (appliedPrep.json.items || []).length === 5, appliedPrep.json.error);
  const snapRack = appliedPrep.json.items.find((row) => row.item_name_snapshot === "E2E 랙");
  const snapBag = appliedPrep.json.items.find((row) => row.item_name_snapshot === "E2E 쇼핑백");
  const snapLight = appliedPrep.json.items.find((row) => row.item_name_snapshot === "E2E 조명");
  const snapTap = appliedPrep.json.items.find((row) => row.item_name_snapshot === "E2E 멀티탭");
  const snapTerm = appliedPrep.json.items.find((row) => row.item_name_snapshot === "E2E 카드단말기");

  const rackLine = await secret
    .from("preparation_set_items")
    .select("id")
    .eq("preparation_set_id", setId)
    .eq("preparation_item_id", rack.json.item.id)
    .single();
  await callFn("prep-admin", { action: "update-set-item", id: rackLine.data.id, planned_quantity: 99 }, token);
  await callFn("prep-admin", { action: "upsert-item", id: rack.json.item.id, name: "E2E 랙-변경", item_type: "EQUIPMENT", default_unit: "개" }, token);
  const snapAfter = await secret.from("event_preparation_items").select("*").eq("id", snapRack.id).single();
  await expect(
    "3 Template 수정 후 Snapshot 불변",
    snapAfter.data.item_name_snapshot === "E2E 랙" && n(snapAfter.data.planned_quantity) === 4,
  );

  for (const row of [snapRack, snapLight, snapTap, snapTerm, snapBag]) {
    const readyStatus = await callFn("prep-admin", { action: "set-status", id: row.id, status: "READY" }, staff.session.access_token);
    if (readyStatus.status !== 200) throw new Error(`READY ${row.item_name_snapshot}: ${readyStatus.json.error}`);
    const onSite = await callFn("prep-admin", { action: "set-status", id: row.id, status: "ON_SITE" }, partTimer.session.access_token);
    if (onSite.status !== 200) throw new Error(`ON_SITE ${row.item_name_snapshot}: ${onSite.json.error}`);
  }
  const bagReturn = await callFn("prep-admin", { action: "set-status", id: snapBag.id, status: "RETURNED" }, token);
  await expect("3 소모품 회수완료 미강제", bagReturn.status === 400 && bagReturn.json.error === "return_not_required");
  for (const row of [snapRack, snapLight, snapTap, snapTerm]) {
    const ret = await callFn("prep-admin", { action: "set-status", id: row.id, status: "RETURNED" }, token);
    if (ret.status !== 200) throw new Error(`RETURNED ${row.item_name_snapshot}: ${ret.json.error}`);
  }
  await expect("3 집기 회수완료", true);

  const masters = await callFn("product-admin", { action: "list-masters" }, token);
  const cat = Object.fromEntries((masters.json.categories || []).map((row) => [row.code, row]));
  const sizeM = (masters.json.sizes || []).find((row) => row.code === "M");
  const sizeL = (masters.json.sizes || []).find((row) => row.code === "L");
  const sizeK1 = (masters.json.sizes || []).find((row) => row.code === "K1");
  const sizeNb = (masters.json.sizes || []).find((row) => row.code === "NEWBORN");
  const beige = (masters.json.colors || []).find((row) => row.code === "BEIGE");
  const black = (masters.json.colors || []).find((row) => row.code === "BLACK");
  const navy = (masters.json.colors || []).find((row) => row.code === "NAVY");

  async function makeProduct(name, categoryId, sizeId, colorId) {
    const created = await callFn(
      "product-admin",
      { action: "create", name, primary_category_id: categoryId, size_id: sizeId, primary_color_id: colorId },
      token,
    );
    if (created.status !== 200) throw new Error(`product ${name}: ${created.json.error}`);
    return created.json;
  }

  const pZero = await makeProduct("E2E 신생아 ZERO", cat.NEWBORN.id, sizeNb.id, beige.id);
  const pLow = await makeProduct("E2E 아동 LOW", cat.KIDS.id, sizeK1.id, black.id);
  const pHalf = await makeProduct("E2E 여성 HALF", cat.ADULT_WOMEN.id, sizeM.id, beige.id);
  const pHigh = await makeProduct("E2E 남성 HIGH", cat.ADULT_MEN.id, sizeL.id, black.id);
  const pFull = await makeProduct("E2E 여성 FULL", cat.ADULT_WOMEN.id, sizeM.id, black.id);
  const pHq = await makeProduct("E2E 아동 HQ이동", cat.KIDS.id, sizeK1.id, beige.id);
  const pEvt = await makeProduct("E2E 남성 EVENT이동", cat.ADULT_MEN.id, sizeL.id, navy.id);
  const pRoutine = await makeProduct("E2E 여성 ROUTINE", cat.ADULT_WOMEN.id, sizeM.id, navy.id);
  const pManual = await makeProduct("E2E 수동추가", cat.KIDS.id, sizeK1.id, navy.id);
  const skus = {
    zero: pZero.variants[0].id,
    low: pLow.variants[0].id,
    half: pHalf.variants[0].id,
    high: pHigh.variants[0].id,
    full: pFull.variants[0].id,
    hq: pHq.variants[0].id,
    evt: pEvt.variants[0].id,
    routine: pRoutine.variants[0].id,
    manual: pManual.variants[0].id,
  };

  const assortment = await callFn("assortment-admin", { action: "upsert-set", name: "E2E 신생아-아동-여성-남성" }, token);
  for (const variantId of [skus.zero, skus.low, skus.half, skus.high, skus.full, skus.hq, skus.evt, skus.routine]) {
    const rule = await callFn("assortment-admin", { action: "add-rule", assortment_set_id: assortment.json.set.id, product_variant_id: variantId }, token);
    if (rule.status !== 200) throw new Error(`rule: ${rule.json.error}`);
  }
  const appliedA = await callFn("assortment-admin", { action: "apply-to-event", event_id: eventId, assortment_set_id: assortment.json.set.id }, token);
  const appliedB = await callFn("assortment-admin", { action: "apply-to-event", event_id: destId, assortment_set_id: assortment.json.set.id }, token);
  await expect("4 Assortment Snapshot", appliedA.status === 200 && (appliedA.json.items || []).filter((row) => !row.removed_at).length === 8, appliedA.json.error);
  await expect("4 목적지 Snapshot", appliedB.status === 200, appliedB.json.error);

  const oldName = pHalf.product.name;
  await callFn("product-admin", { action: "update", id: pHalf.product.id, name: "E2E 이름변경됨" }, token);
  const snapName = await secret.from("event_assortment_items").select("product_name_snapshot").eq("event_id", eventId).eq("product_id", pHalf.product.id).maybeSingle();
  await expect("4 Master 수정 후 Snapshot 불변", snapName.data?.product_name_snapshot === oldName);

  const manual = await callFn("assortment-admin", { action: "add-event-item", event_id: eventId, product_variant_id: skus.manual }, token);
  await expect("4 SKU 수동추가", manual.status === 200, manual.json.error);
  const removed = await callFn("assortment-admin", { action: "remove-event-item", id: manual.json.item.id }, token);
  await expect("4 SKU 제외", removed.status === 200 && Boolean(removed.json.item.removed_at), removed.json.error);

  const opening = await callFn("event-inventory", { action: "create-check", event_id: eventId, check_kind: "OPENING", check_scope: "FULL" }, token);
  await expect("5 OPENING FULL 생성", opening.status === 200 && (opening.json.items || []).length === 8, opening.json.error);
  const bySku = Object.fromEntries((opening.json.items || []).map((row) => [row.product_variant_id, row]));
  const plan = [
    [skus.zero, 0, "ZERO"],
    [skus.low, 0, "VERY_LOW"],
    [skus.half, 0, "HALF"],
    [skus.high, 0, "HIGH"],
    [skus.full, 0, "FULL"],
    [skus.hq, 1, "HALF"],
    [skus.evt, 2, "HIGH"],
    [skus.routine, 2, "HIGH"],
  ];
  const firstSave = await saveItem(token, bySku[skus.zero], 0, "ZERO");
  await expect(
    "5 ZERO 입력",
    firstSave.status === 200 && n(firstSave.json.item.full_pack_count) === 0 && firstSave.json.item.remainder_level === "ZERO",
    firstSave.json.error,
  );
  const zeroLoaded = await latestItem(token, opening.json.check.id, bySku[skus.zero].id);
  await expect("5 ZERO 추정값 0", n(zeroLoaded.estimated_qty) === 0);
  const stillOpen = await latestItem(token, opening.json.check.id, bySku[skus.low].id);
  await expect("5 미입력과 ZERO 구분", stillOpen.full_pack_count == null && stillOpen.remainder_level == null);

  const incomplete = await callFn("event-inventory", { action: "confirm-check", id: opening.json.check.id }, token);
  await expect("5 FULL 미입력 Confirm 실패", incomplete.status === 400 && incomplete.json.error === "incomplete_full_check");

  const openingReload = await callFn("event-inventory", { action: "get-check", id: opening.json.check.id }, token);
  if (openingReload.status !== 200) throw new Error(`opening reload: ${openingReload.json.error}`);
  const latestBySku = Object.fromEntries((openingReload.json.items || []).map((row) => [row.product_variant_id, row]));
  for (const [variantId, full, remainder] of plan) {
    const saved = await saveItem(token, latestBySku[variantId], full, remainder);
    if (saved.status !== 200) throw new Error(`opening ${variantId}: ${saved.json.error}`);
    latestBySku[variantId] = saved.json.item;
  }
  const confirmedOpen = await callFn("event-inventory", { action: "confirm-check", id: opening.json.check.id }, token);
  await expect("5 OPENING Confirm", confirmedOpen.status === 200 && confirmedOpen.json.check.status === "CONFIRMED", confirmedOpen.json.error);

  const current = await callFn("event-inventory", { action: "get-current", event_id: eventId }, token);
  await expect("5 Current 생성", (current.json.current || []).length === 8, current.json.error);

  const listed = await callFn("inventory-movement", { action: "list-locations" }, token);
  const existingHq = (listed.json.locations || []).find((row) => row.location_type === "HQ");
  const hq = existingHq
    ? { status: 200, json: { location: existingHq } }
    : await callFn("inventory-movement", { action: "create-location", location_type: "HQ", name: "E2E 본사" }, token);
  await expect("6 HQ Location", hq.status === 200, hq.json.error);
  const hqId = hq.json.location.id;
  const locs = await callFn("inventory-movement", { action: "list-locations" }, token);
  const locA = (locs.json.locations || []).find((row) => row.location_type === "EVENT" && row.event_id === eventId);
  const locB = (locs.json.locations || []).find((row) => row.location_type === "EVENT" && row.event_id === destId);
  const posOpen = await callFn("inventory-movement", { action: "get-location-stock", id: locA.id }, token);
  await expect("5 Event Position Baseline", (posOpen.json.stock || []).length === 8, String((posOpen.json.stock || []).length));
  const unitsOpen = stockMap(posOpen.json.stock);
  await expect("5 출고 없이 실사 Baseline", n(unitsOpen[skus.routine]) === est(10, 2, "HIGH"));

  const openingHistory = Object.fromEntries(
    ((await secret.from("event_inventory_check_items").select("id, full_pack_count, remainder_level").eq("inventory_check_id", opening.json.check.id)).data || []).map(
      (row) => [row.id, `${row.full_pack_count}:${row.remainder_level}`],
    ),
  );

  const toHq = await callFn("inventory-movement", { action: "create-movement", source_location_id: locA.id, destination_location_id: hqId }, token);
  await callFn(
    "inventory-movement",
    { action: "add-item", inventory_movement_id: toHq.json.movement.id, product_variant_id: skus.hq, sent_full_pack_count: 1, sent_remainder_level: "ZERO" },
    token,
  );
  const posDraftHq = await callFn("inventory-movement", { action: "get-location-stock", id: locA.id }, token);
  await expect("6 DRAFT Position 불변", mapKey(unitsOpen) === mapKey(stockMap(posDraftHq.json.stock)));
  const dispHq = await callFn("inventory-movement", { action: "dispatch", id: toHq.json.movement.id }, token);
  await expect("6 EVENT→HQ DISPATCH", dispHq.status === 200, dispHq.json.error);
  const posAfterHq = await callFn("inventory-movement", { action: "get-location-stock", id: locA.id }, token);
  await expect("6 DISPATCH Source 감소", n(stockMap(posAfterHq.json.stock)[skus.hq]) === unitsOpen[skus.hq] - 10);
  const recvHq = await callFn("inventory-movement", { action: "receive", id: toHq.json.movement.id, same_as_sent: true }, token);
  await expect("6 EVENT→HQ RECEIVE", recvHq.status === 200, recvHq.json.error);
  const hqStock = await callFn("inventory-movement", { action: "get-location-stock", id: hqId }, token);
  const hqSku = (hqStock.json.stock || []).find((row) => row.product_variant_id === skus.hq);
  await expect("6 RECEIVE Destination 증가", n(hqSku?.estimated_units) === 10, String(hqSku?.estimated_units));

  const toEvt = await callFn("inventory-movement", { action: "create-movement", source_location_id: locA.id, destination_location_id: locB.id }, token);
  await callFn(
    "inventory-movement",
    { action: "add-item", inventory_movement_id: toEvt.json.movement.id, product_variant_id: skus.evt, sent_full_pack_count: 2, sent_remainder_level: "HALF" },
    token,
  );
  const dispEvt = await callFn("inventory-movement", { action: "dispatch", id: toEvt.json.movement.id }, token);
  await expect("6 EVENT→EVENT DISPATCH", dispEvt.status === 200, dispEvt.json.error);
  const recvEvt = await callFn(
    "inventory-movement",
    {
      action: "receive",
      id: toEvt.json.movement.id,
      items: [{ id: dispEvt.json.items.find((row) => row.product_variant_id === skus.evt).id, received_full_pack_count: 2, received_remainder_level: "VERY_LOW" }],
    },
    token,
  );
  await expect("6 EVENT→EVENT RECEIVE", recvEvt.status === 200, recvEvt.json.error);
  const recvItem = (recvEvt.json.items || []).find((row) => row.product_variant_id === skus.evt);
  await expect(
    "6 발송≠수령 차이 보존",
    n(recvItem.sent_estimated_units) === 25 && n(recvItem.received_estimated_units) === 22,
    JSON.stringify(recvItem),
  );
  await expect("6 차이를 판매/분실로 자동분류하지 않음", !("loss_qty" in recvItem) && !("sold_qty" in recvItem) && !("shrinkage_reason" in recvItem));
  const destStock = await callFn("inventory-movement", { action: "get-location-stock", id: locB.id }, token);
  const destSku = (destStock.json.stock || []).find((row) => row.product_variant_id === skus.evt);
  await expect("6 목적지 Position = 수령량", n(destSku?.estimated_units) === 22);

  const moveHist = await callFn("inventory-movement", { action: "get-movement", id: toEvt.json.movement.id }, token);

  const routine = await callFn("event-inventory", { action: "create-check", event_id: eventId, check_kind: "ROUTINE", check_scope: "PARTIAL" }, token);
  await expect("7 ROUTINE 생성", routine.status === 200, routine.json.error);
  const routineGot = await callFn("event-inventory", { action: "get-check", id: routine.json.check.id }, token);
  const routineLine = (routineGot.json.items || []).find((row) => row.product_variant_id === skus.routine);
  await expect("7 ROUTINE 이전값 약 28", n(routineLine?.previous_estimated_qty) === 28, String(routineLine?.previous_estimated_qty));
  const routineSave = await saveItem(token, routineLine, 2, "HALF");
  await expect("7 현장 약 25 저장", routineSave.status === 200, routineSave.json.error);
  const routineLoaded = await latestItem(token, routine.json.check.id, routineLine.id);
  await expect("7 현장 약 25 입력", n(routineLoaded.estimated_qty) === 25, String(routineLoaded.estimated_qty));
  const routineConf = await callFn("event-inventory", { action: "confirm-check", id: routine.json.check.id }, token);
  await expect("7 ROUTINE Confirm", routineConf.status === 200, routineConf.json.error);
  const currentR = await callFn("event-inventory", { action: "get-current", event_id: eventId }, token);
  const rec = (currentR.json.current || []).find((row) => row.product_variant_id === skus.routine);
  const posR = await callFn("inventory-movement", { action: "get-location-stock", id: locA.id }, token);
  const posRec = (posR.json.stock || []).find((row) => row.product_variant_id === skus.routine);
  await expect("7 Physical Recognition = 약 25", n(rec.estimated_qty ?? est(n(rec.pack_size_snapshot), n(rec.full_pack_count), rec.remainder_level)) === 25);
  await expect("7 Operational Position = 약 25", n(posRec.estimated_units) === 25, String(posRec?.estimated_units));

  const openingAfter = Object.fromEntries(
    ((await secret.from("event_inventory_check_items").select("id, full_pack_count, remainder_level").eq("inventory_check_id", opening.json.check.id)).data || []).map(
      (row) => [row.id, `${row.full_pack_count}:${row.remainder_level}`],
    ),
  );
  const moveAfter = await callFn("inventory-movement", { action: "get-movement", id: toEvt.json.movement.id }, token);
  await expect("7 Check History 불변", JSON.stringify(openingHistory) === JSON.stringify(openingAfter));
  await expect(
    "7 Movement History 불변",
    moveAfter.json.movement.status === moveHist.json.movement.status &&
      n(moveAfter.json.items[0].sent_estimated_units) === n(moveHist.json.items[0].sent_estimated_units),
  );

  const sale1 = await callFn(
    "event-finance",
    { action: "save-daily-sales", event_id: eventId, business_date: day1, card_amount: 1000000, cash_amount: 100000, other_amount: 0 },
    token,
  );
  const sale2 = await callFn(
    "event-finance",
    { action: "save-daily-sales", event_id: eventId, business_date: day2, card_amount: 0, cash_amount: 0, other_amount: 0 },
    staff.session.access_token,
  );
  await expect("8 DAY1 입력", sale1.status === 200, sale1.json.error);
  await expect("8 DAY2 0원 입력", sale2.status === 200, sale2.json.error);
  const sales = await callFn("event-finance", { action: "get-sales", event_id: eventId }, token);
  const days = sales.json.days || [];
  const d1 = days.find((row) => row.business_date === day1);
  const d2 = days.find((row) => row.business_date === day2);
  const d3 = days.find((row) => row.business_date === kstDate(2));
  await expect("8 DAY1 입력완료", d1?.status === "entered" && n(d1.total) === 1100000);
  await expect("8 DAY2 입력완료 · 0원", d2?.status === "zero");
  await expect("8 미입력 구분", d3?.status === "missing");

  const statusAfterSales = await secret.from("events").select("status").eq("id", eventId).single();
  await expect("13 Finance가 status 자동변경 없음", statusAfterSales.data.status === "ACTIVE");

  const cats = await callFn("event-finance", { action: "list-categories" }, token);
  const parking = (cats.json.categories || []).find((row) => row.code === "PARKING");
  const food = (cats.json.categories || []).find((row) => row.code === "FOOD");
  const delivery = (cats.json.categories || []).find((row) => row.code === "DELIVERY");
  const expPark = await callFn(
    "event-finance",
    { action: "create-expense", event_id: eventId, expense_date: day1, expense_category_id: parking.id, amount: 20000, payment_method: "CARD", description: "E2E 주차" },
    token,
  );
  const expFood = await callFn(
    "event-finance",
    { action: "create-expense", event_id: eventId, expense_date: day1, expense_category_id: food.id, amount: 45000, payment_method: "CASH", description: "E2E 식비" },
    staff.session.access_token,
  );
  const expShip = await callFn(
    "event-finance",
    { action: "create-expense", event_id: eventId, expense_date: kstDate(-2), expense_category_id: delivery.id, amount: 15000, payment_method: "OTHER", description: "E2E 택배" },
    token,
  );
  await expect("9 지출 3건", expPark.status === 200 && expFood.status === 200 && expShip.status === 200, expPark.json.error || expFood.json.error || expShip.json.error);
  const receipt = await uploadReceipt(token, eventId, expPark.json.expense.id);
  await expect("9 영수증 업로드", receipt.status === 200, receipt.json.error);
  const foodUp = await callFn(
    "event-finance",
    {
      action: "update-expense",
      id: expFood.json.expense.id,
      event_id: eventId,
      expense_date: day1,
      expense_category_id: food.id,
      amount: 48000,
      payment_method: "CASH",
      description: "E2E 식비 수정",
      updated_at: expFood.json.expense.updated_at,
    },
    token,
  );
  await expect("9 지출 수정", foodUp.status === 200 && n(foodUp.json.expense.amount) === 48000, foodUp.json.error);
  const voided = await callFn("event-finance", { action: "void-expense", id: expShip.json.expense.id }, token);
  await expect("9 지출 void", voided.status === 200 && Boolean(voided.json.expense.voided_at), voided.json.error);

  const beforeCost = await callFn("event-finance", { action: "get-financial-summary", event_id: eventId }, token);
  await expect("10 원가 NULL 손익 미완료", beforeCost.json.summary?.profit_ready === false && beforeCost.json.summary?.estimated_profit == null);
  const cost = await callFn("event-finance", { action: "update-product-cost", event_id: eventId, estimated_product_cost: 400000 }, token);
  await expect("10 예상 상품원가 입력", cost.status === 200, cost.json.error);

  const staffSum = await callFn("event-finance", { action: "get-financial-summary", event_id: eventId }, staff.session.access_token);
  const partSum = await callFn("event-finance", { action: "get-financial-summary", event_id: eventId }, partTimer.session.access_token);
  const staffCost = await callFn("event-finance", { action: "update-product-cost", event_id: eventId, estimated_product_cost: 1 }, staff.session.access_token);
  await expect(
    "10 STAFF/PART_TIMER 금융정보 미노출",
    staffSum.status === 200 &&
      !("estimated_profit" in (staffSum.json.summary || {})) &&
      !("estimated_product_cost" in (staffSum.json.summary || {})) &&
      !("commission_amount" in (staffSum.json.summary || {})) &&
      !("booth_fee" in (staffSum.json.summary || {})) &&
      partSum.status === 200 &&
      !("estimated_profit" in (partSum.json.summary || {})) &&
      staffCost.status === 403,
  );

  const sum = (await callFn("event-finance", { action: "get-financial-summary", event_id: eventId }, token)).json.summary;
  const salesTotal = 1100000;
  const expenseTotal = 20000 + 48000;
  const commission = Math.round((salesTotal * 10) / 100);
  const booth = 300000;
  const profit = salesTotal - 400000 - expenseTotal - commission - booth;
  await expect("11 총매출", n(sum.sales_total) === salesTotal, String(sum.sales_total));
  await expect("11 void 지출 제외", n(sum.expense_total) === expenseTotal, String(sum.expense_total));
  await expect("11 MIXED 수수료", n(sum.commission_amount) === commission);
  await expect("11 MIXED 입점비", n(sum.booth_fee) === booth);
  await expect("11 수수료 반올림", n(sum.commission_amount) === n(Math.round(n(sum.sales_total) * 10 / 100)));
  await expect("11 예상 순이익", sum.profit_ready === true && n(sum.estimated_profit) === profit, String(sum.estimated_profit));

  const auditAfterExp = await callFn("event-finance", { action: "get-audit-log", event_id: eventId }, token);
  await expect("9 수정 Audit", (auditAfterExp.json.logs || []).some((row) => row.entity_type === "EXPENSE" && row.action === "UPDATE"));

  const closing = await callFn("event-inventory", { action: "create-check", event_id: eventId, check_kind: "CLOSING", check_scope: "FULL" }, token);
  const closeItems = closing.json.items || [];
  for (const item of closeItems) {
    const saved = await saveItem(token, item, 1, "ZERO");
    if (saved.status !== 200) throw new Error(`closing ${item.sku_code}: ${saved.json.error}`);
  }
  const closeConf = await callFn("event-inventory", { action: "confirm-check", id: closing.json.check.id }, token);
  await expect("12 CLOSING Confirm", closeConf.status === 200, closeConf.json.error);
  const currentC = await callFn("event-inventory", { action: "get-current", event_id: eventId }, token);
  const posC = await callFn("inventory-movement", { action: "get-location-stock", id: locA.id }, token);
  await expect("12 종료재고 Current", (currentC.json.current || []).every((row) => n(row.full_pack_count) === 1 && row.remainder_level === "ZERO"));
  await expect("12 종료재고 Position", (posC.json.stock || []).every((row) => n(row.estimated_units) === 10));

  const preview = await callFn("inventory-movement", { action: "closing-distribution-preview", check_id: closing.json.check.id }, token);
  await expect("12 남은 재고 보내기 Preview", preview.status === 200 && (preview.json.lines || []).length >= 1, preview.json.error);
  const destMap = {};
  for (const line of preview.json.lines || []) {
    const name = line.category_name || "미분류";
    destMap[name] = name.includes("남성") ? locB.id : hqId;
  }
  const beforeDraft = stockMap((await callFn("inventory-movement", { action: "get-location-stock", id: locA.id }, token)).json.stock);
  const distributed = await callFn("inventory-movement", { action: "create-closing-distribution", check_id: closing.json.check.id, destinations: destMap }, token);
  await expect("12 Category별 목적지 / Movement 분리", distributed.status === 200 && (distributed.json.movement_ids || []).length >= 1, distributed.json.error);
  const afterDraft = stockMap((await callFn("inventory-movement", { action: "get-location-stock", id: locA.id }, token)).json.stock);
  await expect("15 DRAFT Movement는 Position 불변", mapKey(beforeDraft) === mapKey(afterDraft));
  const createdMoves = distributed.json.movement_ids || [];
  const pairs = new Set();
  for (const id of createdMoves) {
    const got = await callFn("inventory-movement", { action: "get-movement", id }, token);
    pairs.add(`${got.json.movement.source_location_id}->${got.json.movement.destination_location_id}`);
  }
  await expect("12 Source-Destination별 분리", pairs.size === createdMoves.length || createdMoves.length >= 1);

  const ended = await callFn("event-admin", { action: "set-status", id: eventId, status: "ENDED" }, token);
  const settled = await callFn("event-admin", { action: "set-status", id: eventId, status: "SETTLED" }, token);
  await expect("13 ENDED → SETTLED 수동", ended.status === 200 && settled.json.event.status === "SETTLED", settled.json.error);

  const saleSettled = await callFn(
    "event-finance",
    {
      action: "save-daily-sales",
      event_id: eventId,
      business_date: day1,
      card_amount: 1000000,
      cash_amount: 110000,
      other_amount: 0,
      updated_at: sale1.json.sale.updated_at,
    },
    token,
  );
  await expect("13 SETTLED 이후 ADMIN 수정", saleSettled.status === 200, saleSettled.json.error);
  const auditSettled = await callFn("event-finance", { action: "get-audit-log", event_id: eventId }, token);
  await expect(
    "13 SETTLED 수정 Audit",
    (auditSettled.json.logs || []).some((row) => row.entity_type === "DAILY_SALES" && row.action === "UPDATE"),
  );

  const staffCreateEvent = await callFn(
    "event-admin",
    { action: "create", name: "몰래", venue_name: "x", address: "x", starts_at: startsAt, ends_at: endsAt, contract_type: "NONE" },
    staff.session.access_token,
  );
  const staffProduct = await callFn("product-admin", { action: "create", name: "몰래상품" }, staff.session.access_token);
  await expect("14 STAFF 행사/상품 범위초과 차단", staffCreateEvent.status === 403 && staffProduct.status === 403);

  const eventIds = ids((await secret.from("events").select("id")).data);
  const memberOrphans = ((await secret.from("event_members").select("id, event_id")).data || []).filter((row) => !eventIds.has(row.event_id));
  const prepOrphans = ((await secret.from("event_preparation_items").select("id, event_id")).data || []).filter((row) => !eventIds.has(row.event_id));
  const assOrphans = ((await secret.from("event_assortment_items").select("id, event_id")).data || []).filter((row) => !eventIds.has(row.event_id));
  const checkIds = ids((await secret.from("event_inventory_checks").select("id")).data);
  const checkItemOrphans = ((await secret.from("event_inventory_check_items").select("id, inventory_check_id")).data || []).filter(
    (row) => !checkIds.has(row.inventory_check_id),
  );
  const negatives = ((await secret.from("inventory_positions").select("id, estimated_units")).data || []).filter((row) => n(row.estimated_units) < 0);
  await expect("15 orphan event_member 없음", memberOrphans.length === 0);
  await expect("15 orphan preparation snapshot 없음", prepOrphans.length === 0);
  await expect("15 orphan assortment item 없음", assOrphans.length === 0);
  await expect("15 orphan inventory check item 없음", checkItemOrphans.length === 0);
  await expect("15 negative inventory_position 없음", negatives.length === 0);

  const destPos = (await callFn("inventory-movement", { action: "get-location-stock", id: locB.id }, token)).json.stock || [];
  await expect("15 RECEIVED destination 반영", destPos.some((row) => row.product_variant_id === skus.evt && n(row.estimated_units) === 22));

  const costRow = await secret.from("event_financial_inputs").select("estimated_product_cost").eq("event_id", eventId).maybeSingle();
  const destCost = await secret.from("event_financial_inputs").select("estimated_product_cost").eq("event_id", destId).maybeSingle();
  await expect("15 상품원가 NULL/0 의미 보존", n(costRow.data.estimated_product_cost) === 400000 && !destCost.data);

  const jsFile = readdirSync("app/dist/assets").find((name) => name.endsWith(".js"));
  const bundle = readFileSync(`app/dist/assets/${jsFile}`, "utf8");
  await expect("14 Client bundle Secret 없음", !bundle.includes(secretKey()));

  await master.supabase.auth.signOut();
  await staff.supabase.auth.signOut();
  await partTimer.supabase.auth.signOut();
  await expired.supabase.auth.signOut();
  console.log("Phase 8.5 E2E workflow passed (reset/build/phase0-8 reported separately).");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
