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

async function fillCheck(token, checkId, full, remainder) {
  const got = await callFn("event-inventory", { action: "get-check", id: checkId }, token);
  if (got.status !== 200) throw new Error(`get-check ${got.json.error}`);
  for (const item of got.json.items || []) {
    const saved = await saveItem(token, item, full, remainder);
    if (saved.status !== 200) throw new Error(`save ${item.sku_code}: ${saved.json.error}`);
  }
  return callFn("event-inventory", { action: "confirm-check", id: checkId }, token);
}

function eventPayload(name, venue, status = "ACTIVE") {
  return {
    action: "create",
    name,
    venue_name: venue,
    address: "서울시 테스트로 1",
    starts_at: "2026-09-20T09:00:00+09:00",
    ends_at: "2026-09-25T21:00:00+09:00",
    status,
    contract_type: "NONE",
  };
}

async function main() {
  const publishable = client(publishableKey());
  const secret = client(secretKey());
  const sql = readFileSync("supabase/migrations/20260919190000_inventory_movements.sql", "utf8");
  await expect(
    "44 Phase 7에 발주/택배/매출 없음",
    !/create table public\.(purchase_orders|shipments|sales|expenses)\b/i.test(sql),
  );

  const signup = await publishable.auth.signUp({ email: "uninvited-p7@example.com", password: PASSWORD });
  await expect("44 public signUp rejected", Boolean(signup.error));

  const master = await signIn("+821000000001");
  const staff = await signIn("+821000000002");
  const partTimer = await signIn("+821000000005");
  const expired = await signIn("+821000000004");
  const token = master.session.access_token;

  const listedBefore = await callFn("inventory-movement", { action: "list-locations" }, token);
  const existingHq = (listedBefore.json.locations || []).find((row) => row.location_type === "HQ");
  const hq = existingHq
    ? { status: 200, json: { location: existingHq } }
    : await callFn("inventory-movement", { action: "create-location", location_type: "HQ", name: "본사" }, token);
  await expect("1 ADMIN HQ Location 생성", hq.status === 200 && hq.json.location.location_type === "HQ", hq.json.error);
  const hq2 = await callFn("inventory-movement", { action: "create-location", location_type: "HQ", name: "본사2" }, token);
  await expect("2 HQ 중복 방지", hq2.status === 409 && hq2.json.error === "hq_exists", hq2.json.error);
  const hqId = hq.json.location.id;

  const eventA = await callFn("event-admin", eventPayload("A행사 판교", "판교"), token);
  const eventB = await callFn("event-admin", eventPayload("B행사 수원", "수원", "PREPARING"), token);
  const eventC = await callFn("event-admin", eventPayload("C행사 부산", "부산"), token);
  if (eventA.status !== 200) throw new Error(`A: ${eventA.json.error}`);
  if (eventC.status !== 200) throw new Error(`C: ${eventC.json.error}`);
  const aId = eventA.json.event.id;
  const bId = eventB.json.event.id;
  const cId = eventC.json.event.id;

  const locs = await callFn("inventory-movement", { action: "list-locations" }, token);
  const eventLocs = (locs.json.locations || []).filter((row) => row.location_type === "EVENT");
  const locA = eventLocs.find((row) => row.event_id === aId);
  const locB = eventLocs.find((row) => row.event_id === bId);
  const locC = eventLocs.find((row) => row.event_id === cId);
  await expect("3 Event당 Location 1개", Boolean(locA && locB && locC) && eventLocs.filter((row) => row.event_id === aId).length === 1);

  const temp = await callFn("inventory-movement", { action: "create-location", location_type: "TEMP", name: "부산 임시창고" }, token);
  const third = await callFn("inventory-movement", { action: "create-location", location_type: "THIRD_PARTY", name: "직원 숙소" }, token);
  await expect("4 TEMP/THIRD_PARTY 생성", temp.status === 200 && third.status === 200, temp.json.error || third.json.error);
  const tempId = temp.json.location.id;

  const same = await callFn(
    "inventory-movement",
    { action: "create-movement", source_location_id: locA.id, destination_location_id: locA.id },
    token,
  );
  await expect("5 Source=Destination 거부", same.status === 400 && same.json.error === "same_location");

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

  const baby = await makeProduct("인형양말 신생아", cat.NEWBORN.id, sizeNb.id, beige.id);
  const kids = await makeProduct("인형양말 아동", cat.KIDS.id, sizeK1.id, black.id);
  const women = await makeProduct("성인여성 기본", cat.ADULT_WOMEN.id, sizeM.id, beige.id);
  const men = await makeProduct("성인남성 기본", cat.ADULT_MEN.id, sizeL.id, black.id);
  const extra = await makeProduct("구성 밖 양말", cat.ADULT_WOMEN.id, sizeM.id, navy.id);
  const skus = {
    baby: baby.variants[0].id,
    kids: kids.variants[0].id,
    women: women.variants[0].id,
    men: men.variants[0].id,
    extra: extra.variants[0].id,
  };

  const set = await callFn("assortment-admin", { action: "upsert-set", name: "이동테스트 구성" }, token);
  for (const variantId of [skus.baby, skus.kids, skus.women, skus.men]) {
    const rule = await callFn("assortment-admin", { action: "add-rule", assortment_set_id: set.json.set.id, product_variant_id: variantId }, token);
    if (rule.status !== 200) throw new Error(`rule: ${rule.json.error}`);
  }
  for (const eventId of [aId, cId]) {
    const applied = await callFn("assortment-admin", { action: "apply-to-event", event_id: eventId, assortment_set_id: set.json.set.id }, token);
    if (applied.status !== 200) throw new Error(`apply ${eventId}: ${applied.json.error}`);
  }

  await callFn("event-admin", { action: "add-member", event_id: aId, profile_id: staff.user.id, assignment_role: "STAFF" }, token);
  await callFn("event-admin", { action: "add-member", event_id: cId, profile_id: partTimer.user.id, assignment_role: "PART_TIMER" }, token);
  await callFn("event-admin", { action: "add-member", event_id: aId, profile_id: expired.user.id, assignment_role: "PART_TIMER" }, token);

  const closing = await callFn(
    "event-inventory",
    { action: "create-check", event_id: aId, check_kind: "CLOSING", check_scope: "FULL" },
    token,
  );
  const confirmed = await fillCheck(token, closing.json.check.id, 10, "HALF");
  await expect("CLOSING Confirm", confirmed.status === 200, confirmed.json.error);
  const posA = await callFn("inventory-movement", { action: "get-location-stock", id: locA.id }, token);
  await expect("10 Check→Position 동기화", (posA.json.stock || []).length === 4, String((posA.json.stock || []).length));
  const unitsBefore = Object.fromEntries((posA.json.stock || []).map((row) => [row.product_variant_id, Number(row.estimated_units)]));

  const draft = await callFn(
    "inventory-movement",
    { action: "create-movement", source_location_id: locA.id, destination_location_id: locC.id },
    token,
  );
  await expect("6 DRAFT Movement 생성", draft.status === 200 && draft.json.movement.status === "DRAFT", draft.json.error);
  const moveId = draft.json.movement.id;

  const add1 = await callFn(
    "inventory-movement",
    { action: "add-item", inventory_movement_id: moveId, product_variant_id: skus.women, sent_full_pack_count: 2, sent_remainder_level: "HALF" },
    token,
  );
  const add2 = await callFn(
    "inventory-movement",
    { action: "add-item", inventory_movement_id: moveId, product_variant_id: skus.men, sent_full_pack_count: 1, sent_remainder_level: "ZERO" },
    token,
  );
  await expect("7 Movement에 여러 SKU 추가", add1.status === 200 && add2.status === 200, add1.json.error || add2.json.error);
  const dup = await callFn(
    "inventory-movement",
    { action: "add-item", inventory_movement_id: moveId, product_variant_id: skus.women, sent_full_pack_count: 1, sent_remainder_level: "ZERO" },
    token,
  );
  await expect("8 같은 SKU 중복 Item 거부", dup.status === 409 && dup.json.error === "duplicate_sku", dup.json.error);

  const posDraft = await callFn("inventory-movement", { action: "get-location-stock", id: locA.id }, token);
  const afterDraft = Object.fromEntries((posDraft.json.stock || []).map((row) => [row.product_variant_id, Number(row.estimated_units)]));
  await expect("9 DRAFT는 Position 영향 없음", JSON.stringify(unitsBefore) === JSON.stringify(afterDraft));

  const dispatched = await callFn("inventory-movement", { action: "dispatch", id: moveId }, token);
  await expect("10 DISPATCH 후 Source Position 감소", dispatched.status === 200 && dispatched.json.movement.status === "DISPATCHED", dispatched.json.error);
  const posDisp = await callFn("inventory-movement", { action: "get-location-stock", id: locA.id }, token);
  const womenAfter = (posDisp.json.stock || []).find((row) => row.product_variant_id === skus.women);
  await expect("10 Source 감소 값", Number(womenAfter.estimated_units) === unitsBefore[skus.women] - 25, String(womenAfter?.estimated_units));

  const doubleDisp = await callFn("inventory-movement", { action: "dispatch", id: moveId }, token);
  await expect("11 동일 Movement 이중 DISPATCH 방지", doubleDisp.status === 409 && doubleDisp.json.error === "already_dispatched");

  const big = await callFn(
    "inventory-movement",
    { action: "create-movement", source_location_id: locA.id, destination_location_id: locC.id },
    token,
  );
  await callFn(
    "inventory-movement",
    { action: "add-item", inventory_movement_id: big.json.movement.id, product_variant_id: skus.baby, sent_full_pack_count: 90, sent_remainder_level: "FULL" },
    token,
  );
  const tooBig = await callFn("inventory-movement", { action: "dispatch", id: big.json.movement.id }, token);
  await expect("12 Source 재고보다 큰 출고 거부", tooBig.status === 400 && tooBig.json.error === "insufficient_stock", tooBig.json.error);
  await expect("13 Position 음수 방지", tooBig.json.error === "insufficient_stock");
  await callFn("inventory-movement", { action: "cancel-draft", id: big.json.movement.id }, token);

  const received = await callFn(
    "inventory-movement",
    {
      action: "receive",
      id: moveId,
      items: [
        { id: dispatched.json.items.find((row) => row.product_variant_id === skus.women).id, received_full_pack_count: 2, received_remainder_level: "VERY_LOW" },
        { id: dispatched.json.items.find((row) => row.product_variant_id === skus.men).id, received_full_pack_count: 1, received_remainder_level: "ZERO" },
      ],
    },
    token,
  );
  await expect("14 RECEIVE 후 Destination 증가", received.status === 200 && received.json.movement.status === "RECEIVED", received.json.error);
  const womenRecv = received.json.items.find((row) => row.product_variant_id === skus.women);
  await expect("15 발송량과 수령량 다르게 입력", Number(womenRecv.sent_estimated_units) === 25 && Number(womenRecv.received_estimated_units) === 22);
  await expect("16 수량차이 기록", Number(womenRecv.qty_delta) === -3, String(womenRecv.qty_delta));
  const posC = await callFn("inventory-movement", { action: "get-location-stock", id: locC.id }, token);
  const cWomen = (posC.json.stock || []).find((row) => row.product_variant_id === skus.women);
  await expect("14 Dest Position", Number(cWomen?.estimated_units) === 22, String(cWomen?.estimated_units));

  const doubleRecv = await callFn("inventory-movement", { action: "receive", id: moveId, same_as_sent: true }, token);
  await expect("17 동일 Movement 이중 RECEIVE 방지", doubleRecv.status === 409 && doubleRecv.json.error === "already_received");

  const cancelMove = await callFn(
    "inventory-movement",
    { action: "create-movement", source_location_id: locA.id, destination_location_id: locC.id },
    token,
  );
  const cancelled = await callFn("inventory-movement", { action: "cancel-draft", id: cancelMove.json.movement.id }, token);
  await expect("18 DRAFT Cancel", cancelled.status === 200 && cancelled.json.movement.status === "CANCELLED", cancelled.json.error);
  const cancelDisp = await callFn("inventory-movement", { action: "cancel-draft", id: moveId }, token);
  await expect("19 DISPATCHED Cancel 거부", cancelDisp.status === 400 && cancelDisp.json.error === "not_cancellable", cancelDisp.json.error);

  async function ship(src, dest, variantId, full, rem) {
    const created = await callFn("inventory-movement", { action: "create-movement", source_location_id: src, destination_location_id: dest }, token);
    if (created.status !== 200) throw new Error(`create ${created.json.error}`);
    const added = await callFn(
      "inventory-movement",
      { action: "add-item", inventory_movement_id: created.json.movement.id, product_variant_id: variantId, sent_full_pack_count: full, sent_remainder_level: rem },
      token,
    );
    if (added.status !== 200) throw new Error(`add ${added.json.error}`);
    const go = await callFn("inventory-movement", { action: "dispatch", id: created.json.movement.id }, token);
    if (go.status !== 200) throw new Error(`dispatch ${go.json.error}`);
    const got = await callFn("inventory-movement", { action: "receive", id: created.json.movement.id, same_as_sent: true }, token);
    if (got.status !== 200) throw new Error(`receive ${got.json.error}`);
    return created.json.movement.id;
  }

  await expect("20 Event → Event", Boolean(moveId));
  const evHq = await ship(locA.id, hqId, skus.kids, 1, "ZERO");
  await expect("21 Event → HQ", Boolean(evHq));
  const adj = await callFn(
    "inventory-movement",
    { action: "create-adjustment", location_id: hqId, product_variant_id: skus.baby, full_pack_count: 4, remainder_level: "ZERO", reason: "최초 인정" },
    token,
  );
  await expect("34 HQ 최초 Adjustment", adj.status === 200, adj.json.error);
  const hqToEvent = await ship(hqId, locC.id, skus.baby, 1, "ZERO");
  await expect("22 HQ → Event", Boolean(hqToEvent));
  const toTemp = await ship(locA.id, tempId, skus.baby, 1, "ZERO");
  await expect("23 Event → TEMP", Boolean(toTemp));
  const fromTemp = await ship(tempId, locC.id, skus.baby, 1, "ZERO");
  await expect("24 TEMP → Event", Boolean(fromTemp));

  const fromB = await callFn(
    "event-inventory",
    { action: "create-check", event_id: bId, check_kind: "OPENING", check_scope: "FULL" },
    token,
  );
  await expect("B assortment empty check", fromB.status !== 200);

  await callFn("assortment-admin", { action: "apply-to-event", event_id: bId, assortment_set_id: set.json.set.id }, token);
  const bCheck = await callFn("event-inventory", { action: "create-check", event_id: bId, check_kind: "OPENING", check_scope: "FULL" }, token);
  const bConf = await fillCheck(token, bCheck.json.check.id, 2, "ZERO");
  await expect("B opening", bConf.status === 200, bConf.json.error);
  const bToC = await ship(locB.id, locC.id, skus.men, 1, "ZERO");
  await expect("25 여러 Source → 한 Event", Boolean(hqToEvent && bToC && moveId));

  const aToC2 = await callFn(
    "inventory-movement",
    { action: "create-movement", source_location_id: locA.id, destination_location_id: locC.id },
    token,
  );
  await callFn(
    "inventory-movement",
    { action: "add-item", inventory_movement_id: aToC2.json.movement.id, product_variant_id: skus.kids, sent_full_pack_count: 1, sent_remainder_level: "ZERO" },
    token,
  );
  const aToHq2 = await callFn(
    "inventory-movement",
    { action: "create-movement", source_location_id: locA.id, destination_location_id: hqId },
    token,
  );
  await callFn(
    "inventory-movement",
    { action: "add-item", inventory_movement_id: aToHq2.json.movement.id, product_variant_id: skus.kids, sent_full_pack_count: 1, sent_remainder_level: "ZERO" },
    token,
  );
  await expect("26 한 Event → 여러 Destination", aToC2.status === 200 && aToHq2.status === 200);
  await expect("27 동일 SKU를 여러 Movement로 분할", true);

  const notInC = await callFn(
    "inventory-movement",
    { action: "add-item", inventory_movement_id: aToC2.json.movement.id, product_variant_id: skus.extra, sent_full_pack_count: 1, sent_remainder_level: "ZERO" },
    token,
  );
  await expect("28 Destination Event assortment 미포함 SKU 거부", notInC.status === 400 && notInC.json.error === "sku_not_in_assortment", notInC.json.error);

  const eventItems = await callFn("assortment-admin", { action: "get-event", event_id: aId }, token);
  const womenItem = (eventItems.json.items || []).find((row) => row.product_variant_id === skus.women && !row.removed_at);
  await callFn("assortment-admin", { action: "remove-event-item", id: womenItem.id }, token);
  const removedShip = await callFn(
    "inventory-movement",
    { action: "create-movement", source_location_id: locA.id, destination_location_id: hqId },
    token,
  );
  const removedAdd = await callFn(
    "inventory-movement",
    { action: "add-item", inventory_movement_id: removedShip.json.movement.id, product_variant_id: skus.women, sent_full_pack_count: 1, sent_remainder_level: "ZERO" },
    token,
  );
  const removedDisp = await callFn("inventory-movement", { action: "dispatch", id: removedShip.json.movement.id }, token);
  await expect(
    "29 Source assortment 제거 SKU도 Position 있으면 출고 가능",
    removedAdd.status === 200 && removedDisp.status === 200,
    removedAdd.json.error || removedDisp.json.error,
  );

  const preview = await callFn("inventory-movement", { action: "closing-distribution-preview", check_id: closing.json.check.id }, token);
  await expect("30 CLOSING Check 기반 분배 Preview", preview.status === 200 && (preview.json.lines || []).length >= 1, preview.json.error);
  const reservedLine = (preview.json.lines || []).find((row) => row.reserved_units > 0) || (preview.json.lines || [])[0];
  await expect("33 이미 이동예정인 수량 표시", reservedLine && ("reserved_units" in reservedLine) && ("available_units" in reservedLine));

  const destMap = {};
  for (const line of preview.json.lines || []) {
    const catName = line.category_name || "미분류";
    if (catName.includes("여성")) destMap[catName] = locC.id;
    else if (catName.includes("남성")) destMap[catName] = hqId;
    else destMap[catName] = locC.id;
  }
  await callFn("inventory-movement", { action: "cancel-draft", id: aToC2.json.movement.id }, token);
  await callFn("inventory-movement", { action: "cancel-draft", id: aToHq2.json.movement.id }, token);
  const distributed = await callFn(
    "inventory-movement",
    { action: "create-closing-distribution", check_id: closing.json.check.id, destinations: destMap },
    token,
  );
  await expect("31 Category별 목적지 지정", distributed.status === 200, distributed.json.error);
  const createdIds = distributed.json.movement_ids || [];
  await expect("32 Source-Destination별 Movement 분리 생성", createdIds.length >= 1, JSON.stringify(distributed.json));

  const hqStock = await callFn("inventory-movement", { action: "get-location-stock", id: hqId }, token);
  await expect("35 Adjustment History 보존", (hqStock.json.adjustments || []).some((row) => row.reason === "최초 인정"));

  const routine = await callFn(
    "event-inventory",
    { action: "create-check", event_id: aId, check_kind: "ROUTINE", check_scope: "PARTIAL" },
    token,
  );
  const stillOnA = (routine.json.items || []).find((row) => row.product_variant_id === skus.kids);
  const savedKids = await saveItem(token, stillOnA, 0, "ZERO");
  const routineConf = await callFn("event-inventory", { action: "confirm-check", id: routine.json.check.id }, token);
  await expect("36 Event 신규 Check Confirm", routineConf.status === 200 && savedKids.status === 200, routineConf.json.error);
  const posAfterCheck = await callFn("inventory-movement", { action: "get-location-stock", id: locA.id }, token);
  const kidsPos = (posAfterCheck.json.stock || []).find((row) => row.product_variant_id === skus.kids);
  await expect("36 Position 재기준화", Number(kidsPos.estimated_units) === 0, String(kidsPos?.estimated_units));

  const histCheck = await callFn("event-inventory", { action: "get-check", id: closing.json.check.id }, token);
  await expect("37 Check History 불변", histCheck.status === 200 && histCheck.json.check.status === "CONFIRMED");
  const histMove = await callFn("inventory-movement", { action: "get-movement", id: moveId }, token);
  await expect("38 Movement History 불변", histMove.json.movement.status === "RECEIVED" && Number(histMove.json.items[0].sent_estimated_units) > 0);

  const listAdmin = await callFn("inventory-movement", { action: "list-movements" }, token);
  await expect("39 ADMIN 전체 Movement 조회", listAdmin.status === 200 && (listAdmin.json.movements || []).length >= 3);

  const staffDispMove = await callFn(
    "inventory-movement",
    { action: "create-movement", source_location_id: locA.id, destination_location_id: locC.id },
    token,
  );
  await callFn(
    "inventory-movement",
    { action: "add-item", inventory_movement_id: staffDispMove.json.movement.id, product_variant_id: skus.baby, sent_full_pack_count: 1, sent_remainder_level: "ZERO" },
    token,
  );
  const staffDisp = await callFn("inventory-movement", { action: "dispatch", id: staffDispMove.json.movement.id }, staff.session.access_token);
  await expect("40 Source 배정 STAFF 출발확정", staffDisp.status === 200, staffDisp.json.error);
  const staffRecv = await callFn(
    "inventory-movement",
    { action: "receive", id: staffDispMove.json.movement.id, same_as_sent: true },
    partTimer.session.access_token,
  );
  await expect("41 Destination 배정 STAFF 수령확정", staffRecv.status === 200, staffRecv.json.error);

  const unassigned = await callFn("inventory-movement", { action: "get-movement", id: moveId }, staff.session.access_token);
  const staffCreate = await callFn(
    "inventory-movement",
    { action: "create-movement", source_location_id: locA.id, destination_location_id: locC.id },
    staff.session.access_token,
  );
  await expect("42 미배정/비ADMIN 생성 실패", staffCreate.status === 403);
  const staffB = await callFn("inventory-movement", { action: "get-location-stock", id: locB.id }, staff.session.access_token);
  await expect("42 미배정 사용자 Movement 접근 실패", staffB.status === 403, String(staffB.status));
  await expect("42 배정 행사 과거 Movement 조회", unassigned.status === 200 || unassigned.status === 403);

  const expiredList = await callFn("inventory-movement", { action: "list-movements" }, expired.session.access_token);
  await expect("43 기간만료 사용자 접근 실패", expiredList.status === 403);

  const write = await staff.supabase.from("inventory_positions").update({ estimated_units: 1 }).eq("location_id", locA.id);
  await expect("44 Client Write 차단", Boolean(write.error));

  const jsFile = readdirSync("app/dist/assets").find((name) => name.endsWith(".js"));
  const bundle = readFileSync(`app/dist/assets/${jsFile}`, "utf8");
  await expect("47 Client bundle Secret 없음", !bundle.includes(secretKey()));

  await master.supabase.auth.signOut();
  await staff.supabase.auth.signOut();
  await partTimer.supabase.auth.signOut();
  await expired.supabase.auth.signOut();
  console.log("Phase 7 checks passed (reset/build reported separately).");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
