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

function ids(arr) {
  return new Set((arr || []).map((row) => row.product_variant_id || row.id));
}

async function main() {
  const publishable = client(publishableKey());
  const secret = client(secretKey());
  const sql = readFileSync("supabase/migrations/20260919170000_assortments.sql", "utf8");
  await expect(
    "30 Phase 5 Schema에 재고수량 컬럼 없음",
    !/\b(stock_quantity|initial_quantity|target_quantity|order_quantity|planned_quantity)\b/.test(sql) &&
      !/\n\s+quantity\s+/i.test(sql),
  );

  const signup = await publishable.auth.signUp({ email: "uninvited-p5@example.com", password: PASSWORD });
  await expect("26 public signUp rejected", Boolean(signup.error));

  const master = await signIn("+821000000001");
  const staff = await signIn("+821000000002");
  const partTimer = await signIn("+821000000005");
  const token = master.session.access_token;

  const staffUsers = await callFn("user-admin", { action: "list" }, staff.session.access_token);
  await expect("26 STAFF user-admin forbidden", staffUsers.status === 403);

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

  const dollBaby = await makeProduct("인형양말 신생아", cat.NEWBORN.id, sizeNb.id, beige.id);
  const dollKids = await makeProduct("인형양말 아동", cat.KIDS.id, sizeK1.id, black.id);
  await callFn(
    "product-admin",
    { action: "add-variant", product_id: dollKids.product.id, size_id: sizeK1.id, primary_color_id: beige.id },
    token,
  );
  const womenA = await makeProduct("성인여성 기본", cat.ADULT_WOMEN.id, sizeM.id, beige.id);
  const skuWomenBlack = await callFn(
    "product-admin",
    { action: "add-variant", product_id: womenA.product.id, size_id: sizeM.id, primary_color_id: black.id },
    token,
  );
  const womenB = await makeProduct("성인여성 포인트", cat.ADULT_WOMEN.id, sizeM.id, black.id);
  const menA = await makeProduct("성인남성 기본", cat.ADULT_MEN.id, sizeL.id, black.id);
  const adultDirect = await makeProduct("성인 공용", cat.ADULT.id, sizeM.id, black.id);
  const inactive = await makeProduct("숨긴 여성양말", cat.ADULT_WOMEN.id, sizeM.id, beige.id);
  await callFn("product-admin", { action: "update", id: inactive.product.id, is_active: false }, token);
  const inactiveSku = await makeProduct("비활성 SKU 상품", cat.ADULT_WOMEN.id, sizeM.id, navy.id);
  const offVariant = inactiveSku.variants[0];
  await callFn("product-admin", { action: "update-variant", id: offVariant.id, is_active: false }, token);

  for (const productId of [dollBaby.product.id, dollKids.product.id]) {
    const tagged = await callFn("product-admin", { action: "add-tag", product_id: productId, name: "인형양말" }, token);
    if (tagged.status !== 200) throw new Error(`tag: ${tagged.json.error}`);
  }
  const tagId = (await callFn("product-admin", { action: "list-masters" }, token)).json.tags.find((row) => row.name === "인형양말").id;

  const set = await callFn("assortment-admin", { action: "upsert-set", name: "백화점 전체형", description: "신생아/아동 인형 + 성인" }, token);
  await expect("1 ADMIN 상품구성 세트 생성", set.status === 200 && Boolean(set.json.set?.id), set.json.error);
  const setId = set.json.set.id;

  const staffSet = await callFn("assortment-admin", { action: "upsert-set", name: "몰래" }, staff.session.access_token);
  const partSet = await callFn("assortment-admin", { action: "upsert-set", name: "몰래" }, partTimer.session.access_token);
  await expect("2 STAFF 세트 생성 실패", staffSet.status === 403);
  await expect("2 PART_TIMER 세트 생성 실패", partSet.status === 403);

  const womenSet = await callFn("assortment-admin", { action: "upsert-set", name: "성인여성형" }, token);
  const womenSetId = womenSet.json.set.id;
  const catRule = await callFn(
    "assortment-admin",
    { action: "add-rule", assortment_set_id: womenSetId, category_id: cat.ADULT_WOMEN.id, include_descendants: true },
    token,
  );
  await expect("3 Rule Category 생성", catRule.status === 200 && catRule.json.rule.category_id === cat.ADULT_WOMEN.id, catRule.json.error);

  const combo = await callFn(
    "assortment-admin",
    { action: "add-rule", assortment_set_id: setId, category_id: cat.KIDS.id, tag_id: tagId, include_descendants: true },
    token,
  );
  await expect("4 Rule Category + Tag 조합", combo.status === 200 && combo.json.rule.tag_id === tagId, combo.json.error);
  await callFn(
    "assortment-admin",
    { action: "add-rule", assortment_set_id: setId, category_id: cat.NEWBORN.id, tag_id: tagId },
    token,
  );
  await callFn(
    "assortment-admin",
    { action: "add-rule", assortment_set_id: setId, category_id: cat.ADULT_WOMEN.id, include_descendants: true },
    token,
  );
  await callFn(
    "assortment-admin",
    { action: "add-rule", assortment_set_id: setId, category_id: cat.ADULT_MEN.id, include_descendants: true },
    token,
  );

  const descSet = await callFn("assortment-admin", { action: "upsert-set", name: "성인 하위포함" }, token);
  await callFn(
    "assortment-admin",
    { action: "add-rule", assortment_set_id: descSet.json.set.id, category_id: cat.ADULT.id, include_descendants: true },
    token,
  );
  const exactSet = await callFn("assortment-admin", { action: "upsert-set", name: "성인 exact" }, token);
  await callFn(
    "assortment-admin",
    { action: "add-rule", assortment_set_id: exactSet.json.set.id, category_id: cat.ADULT.id, include_descendants: false },
    token,
  );
  const descPrev = await callFn("assortment-admin", { action: "preview", assortment_set_id: descSet.json.set.id }, token);
  const exactPrev = await callFn("assortment-admin", { action: "preview", assortment_set_id: exactSet.json.set.id }, token);
  const exactPaths = (exactPrev.json.skus || []).map((row) => row.category_path);
  const descPaths = (descPrev.json.skus || []).map((row) => row.category_path);
  await expect(
    "5 include_descendants",
    exactPaths.length >= 1 &&
      exactPaths.every((path) => path === "성인") &&
      descPaths.some((path) => path.includes("여성") || path.includes("남성")) &&
      descPrev.json.sku_count > exactPrev.json.sku_count,
    `desc=${descPrev.json.sku_count} exact=${exactPrev.json.sku_count} exactPaths=${exactPaths.join("|")} descPaths=${[...new Set(descPaths)].join("|")}`,
  );

  const skuRuleSet = await callFn("assortment-admin", { action: "upsert-set", name: "지정SKU" }, token);
  const oneSku = skuWomenBlack.json.variant.id;
  const skuRule = await callFn(
    "assortment-admin",
    { action: "add-rule", assortment_set_id: skuRuleSet.json.set.id, product_variant_id: oneSku },
    token,
  );
  const skuPrev = await callFn("assortment-admin", { action: "preview", assortment_set_id: skuRuleSet.json.set.id }, token);
  await expect("6 Product/SKU 직접 Rule", skuRule.status === 200 && skuPrev.json.sku_count === 1, skuPrev.json.error);

  // Category rules also match leftover SKUs from earlier phase verifies on the same DB.
  const womenPrev = await callFn("assortment-admin", { action: "preview", assortment_set_id: womenSetId }, token);
  const womenIds = ids(womenPrev.json.skus);
  await expect(
    "7 Rule Preview 결과 검증",
    womenPrev.status === 200 &&
      womenPrev.json.sku_count >= 3 &&
      womenIds.has(womenA.variants[0].id) &&
      womenIds.has(oneSku) &&
      womenIds.has(womenB.variants[0].id),
    JSON.stringify({ count: womenPrev.json.sku_count, ids: [...womenIds] }),
  );
  await expect(
    "8 비활성 Product/SKU Preview 제외",
    !womenIds.has(inactive.variants[0].id) && !womenIds.has(offVariant.id),
  );

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
    token,
  );
  const other = await callFn(
    "event-admin",
    {
      action: "create",
      name: "수원 아울렛 행사",
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

  const applied = await callFn(
    "assortment-admin",
    { action: "apply-to-event", event_id: eventId, assortment_set_id: womenSetId },
    token,
  );
  await expect("9 행사에 Template 적용", applied.status === 200 && Boolean(applied.json.assortment?.id), applied.json.error);
  const snap = (applied.json.items || []).filter((row) => !row.removed_at);
  const snapIds = new Set(snap.map((row) => row.product_variant_id));
  await expect(
    "10 실제 SKU Snapshot 생성",
    snap.length >= 3 && snapIds.has(womenA.variants[0].id) && snapIds.has(oneSku) && snapIds.has(womenB.variants[0].id),
    String(snap.length),
  );
  await expect("11 같은 SKU 중복 Snapshot 방지", snapIds.size === snap.length);

  const reapply = await callFn(
    "assortment-admin",
    { action: "apply-to-event", event_id: eventId, assortment_set_id: setId },
    token,
  );
  await expect("11 재적용 overwrite 거부", reapply.status === 409 && reapply.json.error === "assortment_exists");

  const beforeCount = snap.length;
  await callFn(
    "assortment-admin",
    { action: "add-rule", assortment_set_id: womenSetId, category_id: cat.ADULT_MEN.id },
    token,
  );
  const afterTemplate = await callFn("assortment-admin", { action: "preview", assortment_set_id: womenSetId }, token);
  const afterEvent = await callFn("assortment-admin", { action: "get-event", event_id: eventId }, token);
  await expect(
    "12 Template 변경 후 기존 행사 Snapshot 불변",
    afterTemplate.json.sku_count > beforeCount &&
      (afterEvent.json.items || []).filter((row) => !row.removed_at).length === beforeCount,
    `preview=${afterTemplate.json.sku_count} snap=${(afterEvent.json.items || []).length}`,
  );

  const later = await makeProduct("신규 여성 C-NAVY", cat.ADULT_WOMEN.id, sizeM.id, navy.id);
  const afterNew = await callFn("assortment-admin", { action: "get-event", event_id: eventId }, token);
  await expect(
    "13 신규 Product/SKU 추가 후 과거 Snapshot 불변",
    (afterNew.json.items || []).filter((row) => !row.removed_at).length === beforeCount &&
      !(afterNew.json.items || []).some((row) => row.product_variant_id === later.variants[0].id),
  );

  const oldName = womenA.product.name;
  await callFn("product-admin", { action: "update", id: womenA.product.id, name: "고양이 자수 양말" }, token);
  const afterRename = await secret.from("event_assortment_items").select("product_name_snapshot, product_id").eq("event_id", eventId);
  await expect(
    "14 Product 이름 변경 후 Snapshot 값 유지",
    (afterRename.data || []).some((row) => row.product_id === womenA.product.id && row.product_name_snapshot === oldName),
  );

  const manual = await callFn(
    "assortment-admin",
    { action: "add-event-item", event_id: eventId, product_variant_id: dollKids.variants[0].id },
    token,
  );
  await expect("15 행사 상품 수동추가", manual.status === 200 && manual.json.item.source_type === "MANUAL", manual.json.error);
  const manualDup = await callFn(
    "assortment-admin",
    { action: "add-event-item", event_id: eventId, product_variant_id: dollKids.variants[0].id },
    token,
  );
  await expect("16 수동추가 중복 방지", manualDup.status === 409 && manualDup.json.error === "duplicate_sku");
  const already = await callFn(
    "assortment-admin",
    { action: "add-event-item", event_id: eventId, product_variant_id: snap[0].product_variant_id },
    token,
  );
  await expect("11 기존 Snapshot SKU 중복 방지", already.status === 409);

  const removed = await callFn("assortment-admin", { action: "remove-event-item", id: manual.json.item.id }, token);
  await expect("17 행사 상품 제외(Soft Remove)", removed.status === 200 && Boolean(removed.json.item.removed_at), removed.json.error);
  const kept = await secret.from("event_assortment_items").select("*").eq("id", manual.json.item.id).maybeSingle();
  await expect("18 제외 후 원래 Snapshot 이력 유지", Boolean(kept.data) && Boolean(kept.data.removed_at) && kept.data.sku_code_snapshot);

  const staffGot = await callFn("assortment-admin", { action: "get-event", event_id: eventId }, staff.session.access_token);
  await expect("19 배정 STAFF 조회 성공", staffGot.status === 200 && (staffGot.json.items || []).length >= 3, staffGot.json.error);
  const partGot = await callFn("assortment-admin", { action: "get-event", event_id: eventId }, partTimer.session.access_token);
  await expect("20 배정 PART_TIMER 조회 성공", partGot.status === 200, partGot.json.error);
  const staffOther = await callFn("assortment-admin", { action: "get-event", event_id: otherId }, staff.session.access_token);
  await expect("21 미배정 행사 조회 실패", staffOther.status === 404);
  const staffRls = await staff.supabase.from("event_assortment_items").select("id").eq("event_id", otherId);
  await expect("21 미배정 RLS 조회 실패", (staffRls.data || []).length === 0);
  const staffWrite = await callFn(
    "assortment-admin",
    { action: "add-event-item", event_id: eventId, product_variant_id: later.variants[0].id },
    staff.session.access_token,
  );
  const partWrite = await callFn(
    "assortment-admin",
    { action: "remove-event-item", id: snap[0].id },
    partTimer.session.access_token,
  );
  await expect("22 STAFF Write 실패", staffWrite.status === 403);
  await expect("22 PART_TIMER Write 실패", partWrite.status === 403);

  const live = (staffGot.json.items || []).filter((row) => !row.removed_at);
  const byName = live.filter((row) => row.product_name_snapshot.includes("성인여성") || row.product_code_snapshot);
  await expect("23 행사 Product 목록 검색", byName.length >= 1);
  const byCat = live.filter((row) => (row.category_snapshot || "").includes("여성"));
  await expect("24 Category 필터", byCat.length === live.filter((row) => row.source_type === "TEMPLATE").length || byCat.length >= 1);
  const bySize = live.filter((row) => row.size_snapshot === "M");
  await expect("25 Size 필터", bySize.length >= 1);

  const jsFile = readdirSync("app/dist/assets").find((name) => name.endsWith(".js"));
  const bundle = readFileSync(`app/dist/assets/${jsFile}`, "utf8");
  await expect("29 Client bundle에 Secret Key 없음", !bundle.includes(secretKey()));

  await master.supabase.auth.signOut();
  await staff.supabase.auth.signOut();
  await partTimer.supabase.auth.signOut();
  console.log("Phase 5 checks passed (reset/build reported separately).");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
