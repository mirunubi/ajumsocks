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

async function uploadPng(token, productId, filename, isPrimary) {
  const signed = await callFn(
    "product-admin",
    {
      action: "sign-upload",
      product_id: productId,
      original_filename: filename,
      mime_type: "image/png",
      file_size: PNG.length,
    },
    token,
  );
  if (signed.status !== 200) throw new Error(`sign-upload failed: ${signed.json.error}`);
  const authed = createClient(apiUrl(), publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { error } = await authed.storage
    .from("product-images")
    .uploadToSignedUrl(signed.json.storage_path, signed.json.token, PNG, {
      contentType: "image/png",
      upsert: true,
    });
  if (error) throw new Error(`upload failed: ${error.message}`);
  const done = await callFn(
    "product-admin",
    {
      action: "complete-upload",
      product_id: productId,
      storage_path: signed.json.storage_path,
      original_filename: filename,
      mime_type: "image/png",
      file_size: PNG.length,
      image_type: "front",
      is_primary: isPrimary,
    },
    token,
  );
  if (done.status !== 200) throw new Error(`complete-upload failed: ${done.json.error}`);
  return { signed: signed.json, complete: done.json };
}

async function main() {
  const publishable = client(publishableKey());
  const secret = client(secretKey());

  const signup = await publishable.auth.signUp({ email: "uninvited-p4@example.com", password: PASSWORD });
  await expect("26 public signUp rejected", Boolean(signup.error));

  const master = await signIn("+821000000001");
  const staff = await signIn("+821000000002");
  const partTimer = await signIn("+821000000005");
  const expired = await signIn("+821000000004");

  const staffUsers = await callFn("user-admin", { action: "list" }, staff.session.access_token);
  await expect("26 STAFF user-admin forbidden", staffUsers.status === 403);

  const created = await callFn(
    "product-admin",
    { action: "create", name: "고양이 자수 무압박 중목양말", country_of_origin: "KR" },
    master.session.access_token,
  );
  await expect("1 ADMIN Product 생성 성공", created.status === 200 && Boolean(created.json.product?.id), created.json.error);
  const product = created.json.product;
  await expect("1 기본 포장단위 10", Number(product.default_pack_quantity) === 10);
  await expect("1 Product Code 발급", /^AJ-\d{6}$/.test(product.product_code), product.product_code);

  const staffCreate = await callFn(
    "product-admin",
    { action: "create", name: "몰래등록" },
    staff.session.access_token,
  );
  await expect("2 STAFF Product 생성 실패", staffCreate.status === 403);
  const partCreate = await callFn(
    "product-admin",
    { action: "create", name: "몰래등록" },
    partTimer.session.access_token,
  );
  await expect("3 PART_TIMER Product 생성 실패", partCreate.status === 403);
  const staffInsert = await staff.supabase.from("products").insert({ name: "직접쓰기", product_code: "HACK-1" });
  await expect("2 STAFF client write 실패", Boolean(staffInsert.error));

  const dupCode = await callFn(
    "product-admin",
    { action: "create", name: "중복코드", product_code: product.product_code },
    master.session.access_token,
  );
  await expect("4 Product Code 중복 실패", dupCode.status === 409 && dupCode.json.error === "duplicate_product_code");

  const masters = await callFn("product-admin", { action: "list-masters" }, master.session.access_token);
  await expect("10 Size Master 동작", (masters.json.sizes || []).some((row) => row.code === "M"));
  await expect("11 Color Master 동작", (masters.json.colors || []).some((row) => row.code === "BEIGE"));
  const adult = (masters.json.categories || []).find((row) => row.code === "ADULT");
  const women = (masters.json.categories || []).find((row) => row.code === "ADULT_WOMEN");
  const kids = (masters.json.categories || []).find((row) => row.code === "KIDS");
  await expect("9 Category 계층 생성", Boolean(adult && women && women.parent_id === adult.id));
  const sizeM = (masters.json.sizes || []).find((row) => row.code === "M");
  const sizeL = (masters.json.sizes || []).find((row) => row.code === "L");
  const sizeK1 = (masters.json.sizes || []).find((row) => row.code === "K1");
  const beige = (masters.json.colors || []).find((row) => row.code === "BEIGE");
  const black = (masters.json.colors || []).find((row) => row.code === "BLACK");
  const cotton = (masters.json.attributes || []).find((row) => row.code === "cotton_pct");
  const style = (masters.json.attributes || []).find((row) => row.code === "sock_style");

  const sku1 = await callFn(
    "product-admin",
    { action: "add-variant", product_id: product.id, size_id: sizeM.id, primary_color_id: beige.id },
    master.session.access_token,
  );
  const sku2 = await callFn(
    "product-admin",
    { action: "add-variant", product_id: product.id, size_id: sizeM.id, primary_color_id: black.id },
    master.session.access_token,
  );
  const sku3 = await callFn(
    "product-admin",
    { action: "add-variant", product_id: product.id, size_id: sizeL.id, primary_color_id: black.id },
    master.session.access_token,
  );
  await expect(
    "5 Product에 SKU 여러 개 생성",
    sku1.status === 200 && sku2.status === 200 && sku3.status === 200 && (sku3.json.variants || []).length === 3,
    sku3.json.error,
  );
  const firstSku = sku1.json.variant;
  await expect("7 SKU Code 불변 형식", firstSku.sku_code === `${product.product_code}-01`, firstSku.sku_code);

  const dupSku = await callFn(
    "product-admin",
    { action: "add-variant", product_id: product.id, sku_code: firstSku.sku_code },
    master.session.access_token,
  );
  await expect("6 SKU Code 중복 실패", dupSku.status === 409 && dupSku.json.error === "duplicate_sku_code");

  const deactivated = await callFn(
    "product-admin",
    { action: "update", id: product.id, is_active: false },
    master.session.access_token,
  );
  await expect("7 Product 비활성화", deactivated.status === 200 && deactivated.json.product.is_active === false);
  const stillThere = await secret.from("products").select("id, is_active").eq("id", product.id).maybeSingle();
  await expect("7 과거 row 유지", stillThere.data?.id === product.id && stillThere.data.is_active === false);

  const skuOff = await callFn(
    "product-admin",
    { action: "update-variant", id: firstSku.id, is_active: false },
    master.session.access_token,
  );
  await expect("8 SKU 비활성화 가능", skuOff.status === 200 && skuOff.json.variants.some((row) => row.id === firstSku.id && row.is_active === false));

  await callFn("product-admin", { action: "update", id: product.id, is_active: true, primary_category_id: women.id }, master.session.access_token);

  const attr = await callFn(
    "product-admin",
    { action: "set-attribute", product_id: product.id, attribute_definition_id: cotton.id, value: 70 },
    master.session.access_token,
  );
  await expect(
    "12 Product Attribute 추가",
    attr.status === 200 && Number(attr.json.attributes[0].value_number) === 70,
    attr.json.error,
  );
  const attrDup = await callFn(
    "product-admin",
    { action: "set-attribute", product_id: product.id, attribute_definition_id: cotton.id, value: 80 },
    master.session.access_token,
  );
  await expect("13 동일 Attribute 중복 방지", attrDup.status === 409 && attrDup.json.error === "duplicate_attribute");
  const styleSet = await callFn(
    "product-admin",
    { action: "set-attribute", product_id: product.id, attribute_definition_id: style.id, value: "중목" },
    master.session.access_token,
  );
  await expect("12 SELECT Attribute", styleSet.status === 200, styleSet.json.error);

  const tag1 = await callFn("product-admin", { action: "add-tag", product_id: product.id, name: "고양이" }, master.session.access_token);
  const tag2 = await callFn("product-admin", { action: "add-tag", product_id: product.id, name: "무압박" }, master.session.access_token);
  await expect("14 Product Tag 여러 개 추가", tag1.status === 200 && tag2.status === 200 && tag2.json.tags.length === 2);
  const tagDup = await callFn("product-admin", { action: "add-tag", product_id: product.id, name: "고양이" }, master.session.access_token);
  await expect("15 동일 Tag 중복 방지", tagDup.status === 409 && tagDup.json.error === "duplicate_tag");

  const img1 = await uploadPng(master.session.access_token, product.id, "front.png", false);
  const img2 = await uploadPng(master.session.access_token, product.id, "pack.png", true);
  await expect("16 Product Image 여러 장 업로드", (img2.complete.images || []).length === 2);
  const primaries = (img2.complete.images || []).filter((row) => row.is_primary);
  await expect("17 대표사진 1개 유지", primaries.length === 1 && primaries[0].original_filename === "pack.png");

  const deletedPath = img1.signed.storage_path;
  const deletedId = (img2.complete.images || []).find((row) => row.storage_path === deletedPath)?.id;
  const del = await callFn("product-admin", { action: "delete-image", id: deletedId }, master.session.access_token);
  const dbLeft = await secret.from("product_images").select("id").eq("id", deletedId);
  const fileName = deletedPath.split("/").slice(1).join("/");
  const listed = await secret.storage.from("product-images").list(product.id);
  const leftover = (listed.data || []).some((file) => file.name === fileName);
  await expect(
    "18 이미지 삭제 시 Storage/metadata 정합성",
    del.status === 200 && (dbLeft.data || []).length === 0 && leftover === false,
    del.json.error || listed.error?.message,
  );

  const staffRead = await staff.supabase.from("products").select("id, name").eq("id", product.id);
  const staffSku = await staff.supabase.from("product_variants").select("id").eq("product_id", product.id);
  const partRead = await partTimer.supabase.from("products").select("id").eq("id", product.id);
  await expect("19 STAFF 상품 READ", (staffRead.data || []).length === 1 && (staffSku.data || []).length === 3);
  await expect("19 PART_TIMER 상품 READ", (partRead.data || []).length === 1);

  const expiredRead = await expired.supabase.from("products").select("id");
  const expiredFn = await callFn("product-admin", { action: "list-products" }, expired.session.access_token);
  await expect(
    "20 기간만료 사용자 상품 READ 실패",
    (expiredRead.data || []).length === 0 && expiredFn.status === 403,
  );

  const other = await callFn(
    "product-admin",
    {
      action: "create",
      name: "아동 파일양말",
      primary_category_id: kids.id,
      size_id: sizeK1.id,
      primary_color_id: black.id,
    },
    master.session.access_token,
  );
  await expect("5 다른 Product 생성", other.status === 200, other.json.error);

  const byCode = await callFn(
    "product-admin",
    { action: "list-products", q: product.product_code },
    master.session.access_token,
  );
  await expect(
    "21 검색 Product Code",
    (byCode.json.products || []).some((row) => row.id === product.id) &&
      !(byCode.json.products || []).some((row) => row.id === other.json.product.id),
  );
  const bySku = await callFn(
    "product-admin",
    { action: "list-products", q: firstSku.sku_code },
    master.session.access_token,
  );
  await expect("22 검색 SKU Code", (bySku.json.products || []).some((row) => row.id === product.id));

  const byCat = await callFn(
    "product-admin",
    { action: "list-products", category_id: women.id },
    master.session.access_token,
  );
  await expect(
    "23 Category Filter",
    (byCat.json.products || []).some((row) => row.id === product.id) &&
      !(byCat.json.products || []).some((row) => row.id === other.json.product.id),
  );
  const bySize = await callFn("product-admin", { action: "list-products", size_id: sizeM.id }, master.session.access_token);
  await expect(
    "24 Size Filter",
    (bySize.json.products || []).some((row) => row.id === product.id) &&
      !(bySize.json.products || []).some((row) => row.id === other.json.product.id),
  );
  const byColor = await callFn(
    "product-admin",
    { action: "list-products", color_id: beige.id },
    master.session.access_token,
  );
  await expect(
    "25 Color Filter",
    (byColor.json.products || []).some((row) => row.id === product.id) &&
      !(byColor.json.products || []).some((row) => row.id === other.json.product.id),
  );

  const jsFile = readdirSync("app/dist/assets").find((name) => name.endsWith(".js"));
  const bundle = readFileSync(`app/dist/assets/${jsFile}`, "utf8");
  await expect("29 Client bundle에 Secret Key 없음", !bundle.includes(secretKey()));

  await master.supabase.auth.signOut();
  await staff.supabase.auth.signOut();
  await partTimer.supabase.auth.signOut();
  await expired.supabase.auth.signOut();
  console.log("Phase 4 checks passed (reset/build reported separately).");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
