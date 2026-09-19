import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { apiUrl, publishableKey, secretKey } from "./local-keys.mjs";

const PASSWORD = process.env.LOCAL_DEV_PASSWORD;
if (!PASSWORD || PASSWORD.length < 8) {
  console.error("Set LOCAL_DEV_PASSWORD (8+ characters). Do not commit it.");
  process.exit(1);
}

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

function est(pack, full, remainder) {
  return full * pack + MID[remainder];
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

async function fillAll(token, checkId, full, remainder) {
  const got = await callFn("event-inventory", { action: "get-check", id: checkId }, token);
  if (got.status !== 200) throw new Error(`get-check ${got.json.error}`);
  for (const item of got.json.items || []) {
    const saved = await saveItem(token, item, full, remainder);
    if (saved.status !== 200) throw new Error(`save-item ${item.sku_code}: ${saved.json.error}`);
  }
  return callFn("event-inventory", { action: "get-check", id: checkId }, token);
}

async function main() {
  const publishable = client(publishableKey());
  const secret = client(secretKey());
  const inventorySql = readFileSync("supabase/migrations/20260919180000_event_inventory.sql", "utf8");
  const assortmentSql = readFileSync("supabase/migrations/20260919170000_assortments.sql", "utf8");

  await expect(
    "31 Phase 5 assortment에 재고수량 컬럼 없음",
    !/\b(stock_quantity|initial_quantity|target_quantity|order_quantity|planned_quantity)\b/.test(assortmentSql),
  );
  await expect(
    "31 Phase 6에 Location/Movement/출고 없음",
    !/create table public\.(inventory_locations|inventory_movements|shipments|purchase_orders)\b/i.test(inventorySql) &&
      !/\b(sold_qty|sales_qty|inferred_sales)\b/.test(inventorySql),
  );
  await expect(
    "10 대표 추정값은 저장하지 않음",
    !/estimated_qty|approx_qty|representative_qty/.test(inventorySql),
  );

  const signup = await publishable.auth.signUp({ email: "uninvited-p6@example.com", password: PASSWORD });
  await expect("31 public signUp rejected", Boolean(signup.error));

  const master = await signIn("+821000000001");
  const staff = await signIn("+821000000002");
  const partTimer = await signIn("+821000000005");
  const expired = await signIn("+821000000004");
  const token = master.session.access_token;

  const staffUsers = await callFn("user-admin", { action: "list" }, staff.session.access_token);
  await expect("31 STAFF user-admin forbidden", staffUsers.status === 403);

  const masters = await callFn("product-admin", { action: "list-masters" }, token);
  const cat = Object.fromEntries((masters.json.categories || []).map((row) => [row.code, row]));
  const sizeM = (masters.json.sizes || []).find((row) => row.code === "M");
  const beige = (masters.json.colors || []).find((row) => row.code === "BEIGE");
  const black = (masters.json.colors || []).find((row) => row.code === "BLACK");
  const navy = (masters.json.colors || []).find((row) => row.code === "NAVY");

  async function makeProduct(name, colorId) {
    const created = await callFn(
      "product-admin",
      {
        action: "create",
        name,
        primary_category_id: cat.ADULT_WOMEN.id,
        size_id: sizeM.id,
        primary_color_id: colorId,
      },
      token,
    );
    if (created.status !== 200) throw new Error(`product ${name}: ${created.json.error}`);
    return created.json;
  }

  const womenA = await makeProduct("고양이 양말", beige.id);
  const skuBlack = await callFn(
    "product-admin",
    { action: "add-variant", product_id: womenA.product.id, size_id: sizeM.id, primary_color_id: black.id },
    token,
  );
  const womenB = await makeProduct("성인여성 기본", black.id);
  const outside = await makeProduct("행사구성 밖 양말", navy.id);

  const set = await callFn("assortment-admin", { action: "upsert-set", name: "현장실사 지정SKU" }, token);
  for (const variantId of [womenA.variants[0].id, skuBlack.json.variant.id, womenB.variants[0].id]) {
    const rule = await callFn(
      "assortment-admin",
      { action: "add-rule", assortment_set_id: set.json.set.id, product_variant_id: variantId },
      token,
    );
    if (rule.status !== 200) throw new Error(`rule ${variantId}: ${rule.json.error}`);
  }

  const event = await callFn(
    "event-admin",
    {
      action: "create",
      name: "판교 현장실사 행사",
      venue_name: "현대백화점 판교점",
      address: "경기도 성남시 분당구 판교역로 146",
      starts_at: "2026-09-20T09:00:00+09:00",
      ends_at: "2026-09-25T21:00:00+09:00",
      status: "ACTIVE",
      contract_type: "NONE",
    },
    token,
  );
  const other = await callFn(
    "event-admin",
    {
      action: "create",
      name: "미배정 대조 행사",
      venue_name: "수원",
      address: "경기도 수원시",
      starts_at: "2026-09-28T10:00:00+09:00",
      ends_at: "2026-10-03T20:00:00+09:00",
      status: "PREPARING",
      contract_type: "NONE",
    },
    token,
  );
  if (event.status !== 200) throw new Error(`event create: ${event.json.error}`);
  if (other.status !== 200) throw new Error(`other event create: ${other.json.error}`);
  const eventId = event.json.event.id;
  const otherId = other.json.event.id;

  await callFn("event-admin", { action: "add-member", event_id: eventId, profile_id: staff.user.id, assignment_role: "STAFF" }, token);
  await callFn(
    "event-admin",
    { action: "add-member", event_id: eventId, profile_id: partTimer.user.id, assignment_role: "PART_TIMER" },
    token,
  );
  await callFn(
    "event-admin",
    { action: "add-member", event_id: eventId, profile_id: expired.user.id, assignment_role: "PART_TIMER" },
    token,
  );

  const applied = await callFn(
    "assortment-admin",
    { action: "apply-to-event", event_id: eventId, assortment_set_id: set.json.set.id },
    token,
  );
  if (applied.status !== 200) throw new Error(`apply: ${applied.json.error}`);
  const liveSkus = (applied.json.items || []).filter((row) => !row.removed_at);
  await expect("행사 활성 SKU 3개", liveSkus.length === 3, String(liveSkus.length));

  const opening = await callFn(
    "event-inventory",
    { action: "create-check", event_id: eventId, check_kind: "OPENING", check_scope: "FULL" },
    token,
  );
  await expect("1 ADMIN Check 생성 성공", opening.status === 200 && Boolean(opening.json.check?.id), opening.json.error);
  await expect("22 OPENING Check", opening.json.check.check_kind === "OPENING");
  const openingId = opening.json.check.id;
  const openingVariants = new Set((opening.json.items || []).map((row) => row.product_variant_id));
  await expect("5 행사구성 밖 SKU는 Check에 없음", !openingVariants.has(outside.variants[0].id));
  await expect("Check 시작 시 활성 SKU 복사", opening.json.items.length === 3);

  const staffCreate = await callFn(
    "event-inventory",
    { action: "create-check", event_id: eventId, check_kind: "ROUTINE", check_scope: "PARTIAL" },
    staff.session.access_token,
  );
  await expect("2 배정 STAFF Check 생성 성공", staffCreate.status === 200 && staffCreate.json.check.check_kind === "ROUTINE", staffCreate.json.error);
  await expect("23 ROUTINE Check", staffCreate.json.check.check_kind === "ROUTINE");

  const partCreate = await callFn(
    "event-inventory",
    { action: "create-check", event_id: eventId, check_kind: "CLOSING", check_scope: "PARTIAL" },
    partTimer.session.access_token,
  );
  await expect("3 배정 PART_TIMER Check 생성 성공", partCreate.status === 200, partCreate.json.error);
  await expect("24 CLOSING Check", partCreate.json.check.check_kind === "CLOSING");

  const unassigned = await callFn(
    "event-inventory",
    { action: "create-check", event_id: otherId, check_kind: "ROUTINE", check_scope: "FULL" },
    staff.session.access_token,
  );
  await expect("4 미배정 사용자 생성 실패", unassigned.status === 403);

  const sneaky = await staff.supabase.from("event_inventory_check_items").insert({
    inventory_check_id: openingId,
    event_id: eventId,
    event_assortment_item_id: (opening.json.items[0] || {}).event_assortment_item_id,
    product_variant_id: outside.variants[0].id,
    pack_size_snapshot: 10,
    full_pack_count: 1,
    remainder_level: "ZERO",
  });
  await expect("5 행사구성 밖 SKU 입력 실패", Boolean(sneaky.error) || (sneaky.data || []).length === 0);

  await callFn("event-inventory", { action: "cancel-check", id: staffCreate.json.check.id }, staff.session.access_token);
  await callFn("event-inventory", { action: "cancel-check", id: partCreate.json.check.id }, partTimer.session.access_token);

  const firstItem = opening.json.items[0];
  const secondItem = opening.json.items[1];
  const thirdItem = opening.json.items[2];
  const savedDraft = await saveItem(token, firstItem, 2, "HALF");
  await expect("6 DRAFT 저장", savedDraft.status === 200 && savedDraft.json.item.full_pack_count === 2, savedDraft.json.error);
  const reopened = await callFn("event-inventory", { action: "get-check", id: openingId }, token);
  await expect(
    "6 DRAFT 재접속 유지",
    reopened.status === 200 &&
      reopened.json.check.status === "DRAFT" &&
      reopened.json.items.some((row) => row.id === firstItem.id && row.full_pack_count === 2 && row.remainder_level === "HALF"),
    reopened.json.error,
  );

  const zeroed = await saveItem(token, { ...secondItem, updated_at: reopened.json.items.find((row) => row.id === secondItem.id).updated_at }, 0, "ZERO");
  const afterZero = await callFn("event-inventory", { action: "get-check", id: openingId }, token);
  const zeroRow = afterZero.json.items.find((row) => row.id === secondItem.id);
  const openRow = afterZero.json.items.find((row) => row.id === thirdItem.id);
  await expect(
    "7 미입력과 ZERO 구분",
    zeroed.status === 200 &&
      zeroRow.full_pack_count === 0 &&
      zeroRow.remainder_level === "ZERO" &&
      zeroRow.estimated_qty === 0 &&
      openRow.full_pack_count == null &&
      openRow.remainder_level == null &&
      openRow.estimated_qty == null,
    JSON.stringify({ zero: zeroRow, open: openRow, err: zeroed.json.error }),
  );

  const badPack = await saveItem(token, { ...thirdItem, updated_at: openRow.updated_at }, -1, "HALF");
  await expect("8 full_pack_count validation", badPack.status === 400 && badPack.json.error === "invalid_pack_count");
  const badRem = await saveItem(token, { ...thirdItem, updated_at: openRow.updated_at }, 1, "LOW");
  await expect("9 remainder_level validation", badRem.status === 400 && badRem.json.error === "invalid_remainder");

  const packed = afterZero.json.items.find((row) => row.id === firstItem.id);
  await expect(
    "10 대표 추정값 계산",
    packed.estimated_qty === est(Number(packed.pack_size_snapshot), 2, "HALF") && packed.estimated_qty === 25,
    String(packed.estimated_qty),
  );
  const dbItem = await secret.from("event_inventory_check_items").select("*").eq("id", firstItem.id).maybeSingle();
  await expect("10 DB에 추정값 컬럼 없음", dbItem.data && !("estimated_qty" in dbItem.data));

  const incomplete = await callFn("event-inventory", { action: "confirm-check", id: openingId }, token);
  await expect("11 FULL Check 미입력 존재 시 Confirm 실패", incomplete.status === 400 && incomplete.json.error === "incomplete_full_check");

  const addedDuring = await callFn(
    "assortment-admin",
    { action: "add-event-item", event_id: eventId, product_variant_id: outside.variants[0].id },
    token,
  );
  if (addedDuring.status !== 200 && addedDuring.json.error !== "duplicate_sku") {
    throw new Error(`add during check: ${addedDuring.json.error}`);
  }
  const still = await callFn("event-inventory", { action: "get-check", id: openingId }, token);
  await expect("16 FULL 대상목록 고정", still.json.items.length === opening.json.items.length);

  const latestThird = still.json.items.find((row) => row.id === thirdItem.id);
  const fillThird = await saveItem(token, latestThird, 1, "FULL");
  await expect("FULL 나머지 입력", fillThird.status === 200, fillThird.json.error);
  const confirmed = await callFn("event-inventory", { action: "confirm-check", id: openingId }, token);
  await expect("12 FULL 전체입력 후 Confirm 성공", confirmed.status === 200 && confirmed.json.check.status === "CONFIRMED", confirmed.json.error);

  const current1 = await callFn("event-inventory", { action: "get-current", event_id: eventId }, token);
  await expect(
    "15 최초 Confirm으로 Current 생성",
    current1.status === 200 && (current1.json.current || []).length === opening.json.items.length,
    JSON.stringify({ n: (current1.json.current || []).length, err: current1.json.error }),
  );
  const firstRecognized = Object.fromEntries((current1.json.current || []).map((row) => [row.product_variant_id, row.first_recognized_at]));
  const firstValues = Object.fromEntries(
    (current1.json.current || []).map((row) => [row.product_variant_id, `${row.full_pack_count}:${row.remainder_level}`]),
  );

  const historyBefore = await secret.from("event_inventory_check_items").select("*").eq("inventory_check_id", openingId);
  const openingHistory = Object.fromEntries((historyBefore.data || []).map((row) => [row.id, `${row.full_pack_count}:${row.remainder_level}`]));

  const saveConfirmed = await saveItem(token, { ...confirmed.json.items[0], updated_at: confirmed.json.items[0].updated_at }, 9, "HIGH");
  await expect("18 CONFIRMED Check 수정 실패", saveConfirmed.status === 400 && saveConfirmed.json.error === "not_draft");

  const double = await callFn("event-inventory", { action: "confirm-check", id: openingId }, token);
  await expect("19 동일 Check 이중 Confirm 방지", double.status === 409 && double.json.error === "already_confirmed");
  const currentAfterDouble = await callFn("event-inventory", { action: "get-current", event_id: eventId }, token);
  await expect(
    "19 이중 Confirm 시 Current 재적용 없음",
    (currentAfterDouble.json.current || []).every((row) => row.source_check_id === openingId),
  );

  const partial = await callFn(
    "event-inventory",
    { action: "create-check", event_id: eventId, check_kind: "ROUTINE", check_scope: "PARTIAL" },
    token,
  );
  const targetSku = partial.json.items[0];
  const untouchedSku = partial.json.items[1];
  const partialSave = await saveItem(token, targetSku, 1, "VERY_LOW");
  await expect("PARTIAL 1건 입력", partialSave.status === 200, partialSave.json.error);
  const afterPartialSave = await callFn("event-inventory", { action: "get-check", id: partial.json.check.id }, token);
  const withPrev = afterPartialSave.json.items.find((row) => row.id === targetSku.id);
  await expect(
    "25 이전값/현재값 차이 계산",
    withPrev.previous_estimated_qty != null && withPrev.delta_qty === withPrev.estimated_qty - withPrev.previous_estimated_qty,
    JSON.stringify({ prev: withPrev.previous_estimated_qty, cur: withPrev.estimated_qty, delta: withPrev.delta_qty }),
  );
  await expect("26 차이를 판매량으로 저장하지 않음", !("sold_qty" in withPrev) && !("sales_qty" in withPrev) && !("inferred_sales" in withPrev));

  const partialConfirm = await callFn("event-inventory", { action: "confirm-check", id: partial.json.check.id }, token);
  await expect("13 PARTIAL 일부입력 Confirm 성공", partialConfirm.status === 200 && partialConfirm.json.check.status === "CONFIRMED", partialConfirm.json.error);

  const current2 = await callFn("event-inventory", { action: "get-current", event_id: eventId }, token);
  const updated = (current2.json.current || []).find((row) => row.product_variant_id === targetSku.product_variant_id);
  const untouched = (current2.json.current || []).find((row) => row.product_variant_id === untouchedSku.product_variant_id);
  await expect(
    "16 두 번째 실사 Confirm으로 Current 갱신",
    updated && updated.full_pack_count === 1 && updated.remainder_level === "VERY_LOW" && updated.source_check_id === partial.json.check.id,
  );
  await expect(
    "14 PARTIAL 미입력 SKU Current 불변",
    untouched && `${untouched.full_pack_count}:${untouched.remainder_level}` === firstValues[untouchedSku.product_variant_id],
  );
  await expect(
    "15 first_recognized_at 유지",
    updated.first_recognized_at === firstRecognized[targetSku.product_variant_id],
  );

  const historyAfter = await secret.from("event_inventory_check_items").select("*").eq("inventory_check_id", openingId);
  const openingHistoryAfter = Object.fromEntries((historyAfter.data || []).map((row) => [row.id, `${row.full_pack_count}:${row.remainder_level}`]));
  await expect(
    "17 이전 실사 History 불변",
    JSON.stringify(openingHistory) === JSON.stringify(openingHistoryAfter),
  );

  const cancelDraft = await callFn(
    "event-inventory",
    { action: "create-check", event_id: eventId, check_kind: "ROUTINE", check_scope: "PARTIAL" },
    token,
  );
  const cancelSave = await saveItem(token, cancelDraft.json.items[0], 8, "HIGH");
  await expect("DRAFT 취소 전 저장", cancelSave.status === 200, cancelSave.json.error);
  const cancelled = await callFn("event-inventory", { action: "cancel-check", id: cancelDraft.json.check.id }, token);
  await expect("20 DRAFT Cancel 성공", cancelled.status === 200 && cancelled.json.check.status === "CANCELLED", cancelled.json.error);
  const current3 = await callFn("event-inventory", { action: "get-current", event_id: eventId }, token);
  const afterCancel = (current3.json.current || []).find((row) => row.product_variant_id === cancelDraft.json.items[0].product_variant_id);
  const beforeCancel = (current2.json.current || []).find((row) => row.product_variant_id === cancelDraft.json.items[0].product_variant_id);
  await expect(
    "21 Cancelled Check가 Current에 영향 없음",
    afterCancel && beforeCancel && afterCancel.full_pack_count === beforeCancel.full_pack_count && afterCancel.source_check_id === beforeCancel.source_check_id,
  );
  const cancelConfirmed = await callFn("event-inventory", { action: "cancel-check", id: openingId }, token);
  await expect("CONFIRMED Cancel 거부", cancelConfirmed.status === 400);

  const staffCurrent = await callFn("event-inventory", { action: "get-current", event_id: eventId }, staff.session.access_token);
  await expect(
    "27 배정 STAFF 해당 행사 Current 조회",
    staffCurrent.status === 200 && (staffCurrent.json.current || []).length >= 1,
    staffCurrent.json.error,
  );
  const staffOther = await callFn("event-inventory", { action: "get-current", event_id: otherId }, staff.session.access_token);
  await expect("28 미배정 사용자 Current 조회 실패", staffOther.status === 403);
  const staffRls = await staff.supabase.from("event_inventory_current").select("id").eq("event_id", otherId);
  await expect("28 미배정 RLS 조회 실패", (staffRls.data || []).length === 0);

  const expiredCurrent = await callFn("event-inventory", { action: "get-current", event_id: eventId }, expired.session.access_token);
  const expiredRls = await expired.supabase.from("event_inventory_current").select("id").eq("event_id", eventId);
  await expect(
    "29 기간만료 사용자 접근 실패",
    expiredCurrent.status === 403 && (expiredRls.data || []).length === 0,
  );

  await callFn("product-admin", { action: "update", id: womenA.product.id, is_active: false }, token);
  await callFn("product-admin", { action: "update-variant", id: skuBlack.json.variant.id, is_active: false }, token);
  const historyStill = await callFn("event-inventory", { action: "get-check", id: openingId }, token);
  await expect(
    "30 Product/SKU 비활성화 후 기존 실사 History 보존",
    historyStill.status === 200 &&
      historyStill.json.check.status === "CONFIRMED" &&
      (historyStill.json.items || []).length === opening.json.items.length &&
      (historyStill.json.items || []).every((row) => row.full_pack_count != null),
    historyStill.json.error,
  );

  const clientWrite = await staff.supabase.from("event_inventory_current").update({ full_pack_count: 99 }).eq("event_id", eventId);
  const rpcWrite = await staff.supabase.rpc("confirm_event_inventory_check", {
    p_check_id: openingId,
    p_confirmed_by: staff.user.id,
  });
  await expect("30 Client Write/RPC 차단", Boolean(clientWrite.error) && Boolean(rpcWrite.error));

  const jsFile = readdirSync("app/dist/assets").find((name) => name.endsWith(".js"));
  const bundle = readFileSync(`app/dist/assets/${jsFile}`, "utf8");
  await expect("34 Client bundle Secret 없음", !bundle.includes(secretKey()));

  await master.supabase.auth.signOut();
  await staff.supabase.auth.signOut();
  await partTimer.supabase.auth.signOut();
  await expired.supabase.auth.signOut();
  console.log("Phase 6 checks passed (reset/build reported separately).");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
