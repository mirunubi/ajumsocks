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

async function signIn(phone) {
  const supabase = client(publishableKey());
  const email = `${phone.replace(/\D/g, "")}@users.local.ajumsocks`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
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

function requireOk(label, result) {
  if (result.status !== 200) throw new Error(`${label}: ${result.status} ${result.json.error || JSON.stringify(result.json)}`);
  return result.json;
}

const STYLES = [
  ["파일럿 양말", "ADULT_WOMEN", "M"],
  ["리본 양말", "ADULT_WOMEN", "M"],
  ["스트라이프 양말", "ADULT_WOMEN", "L"],
  ["도트 양말", "ADULT_WOMEN", "M"],
  ["하트 양말", "ADULT_WOMEN", "M"],
  ["체크 양말", "ADULT_MEN", "L"],
  ["베이직 남성", "ADULT_MEN", "L"],
  ["무지 남성", "ADULT_MEN", "M"],
  ["별 아동", "KIDS", "K1"],
  ["꽃무늬 아동", "KIDS", "K1"],
  ["무지개 아동", "KIDS", "K2"],
  ["신생아 베이직", "NEWBORN", "NEWBORN"],
];

async function main() {
  const admin = await signIn("+821000000001");
  const token = admin.session.access_token;
  console.log("signed in ADMIN");

  const listed = await callFn("organizer-admin", { action: "list" }, token);
  requireOk("organizer list", listed);
  let organizer = (listed.json.organizers || []).find((row) => row.name === "네이처플러스");
  if (!organizer) {
    const created = await callFn(
      "organizer-admin",
      {
        action: "create",
        name: "네이처플러스",
        calendar_color: "#16A34A",
        default_contract_type: "COMMISSION",
        default_commission_rate: 18,
        memo: "Pilot rehearsal default terms",
      },
      token,
    );
    organizer = requireOk("organizer create", created).organizer;
  }
  const orgGet = requireOk("organizer get", await callFn("organizer-admin", { action: "get", id: organizer.id }, token));
  const contacts = orgGet.contacts || [];
  if (contacts.length < 2) {
    if (!contacts.some((row) => row.name === "김본사")) {
      requireOk(
        "contact HQ",
        await callFn(
          "organizer-admin",
          { action: "add-contact", organizer_id: organizer.id, contact_type: "HQ", name: "김본사", department: "영업", position: "과장", phone: "010-1111-0001" },
          token,
        ),
      );
    }
    if (!contacts.some((row) => row.name === "박매장")) {
      requireOk(
        "contact VENUE",
        await callFn(
          "organizer-admin",
          { action: "add-contact", organizer_id: organizer.id, contact_type: "VENUE", name: "박매장", department: "판교점", position: "담당", phone: "010-2222-0002" },
          token,
        ),
      );
    }
  }

  const masters = requireOk("masters", await callFn("product-admin", { action: "list-masters" }, token));
  const cat = Object.fromEntries((masters.categories || []).map((row) => [row.code, row]));
  const sizes = Object.fromEntries((masters.sizes || []).map((row) => [row.code, row]));
  const colors = ["BEIGE", "BLACK", "NAVY"].map((code) => (masters.colors || []).find((row) => row.code === code));
  if (colors.some((row) => !row)) throw new Error("expected BEIGE/BLACK/NAVY colors");

  const secret = client(secretKey());
  const variantIds = [];
  const productIds = [];
  for (const [name, catCode, sizeCode] of STYLES) {
    const existing = await secret.from("products").select("id, name").eq("name", name).maybeSingle();
    let product = existing.data;
    let variants = [];
    if (product) {
      const got = requireOk(`get ${name}`, await callFn("product-admin", { action: "get", id: product.id }, token));
      variants = got.variants || [];
    } else {
      const created = requireOk(
        `product ${name}`,
        await callFn(
          "product-admin",
          {
            action: "create",
            name,
            primary_category_id: cat[catCode].id,
            size_id: sizes[sizeCode].id,
            primary_color_id: colors[0].id,
          },
          token,
        ),
      );
      product = created.product;
      variants = created.variants || [];
    }
    productIds.push(product.id);
    const haveColors = new Set(variants.map((row) => row.primary_color_id));
    for (const color of colors) {
      if (!haveColors.has(color.id)) {
        const added = requireOk(
          `variant ${name} ${color.code}`,
          await callFn("product-admin", { action: "add-variant", product_id: product.id, size_id: sizes[sizeCode].id, primary_color_id: color.id }, token),
        );
        variants.push(added.variant);
      }
    }
    for (const variant of variants) variantIds.push(variant.id);
    console.log(`product ${name}: ${variants.length} SKUs`);
  }
  const uniqueVariants = [...new Set(variantIds)];
  if (uniqueVariants.length < 30) throw new Error(`expected 30+ SKUs, got ${uniqueVariants.length}`);

  const sets = requireOk("assortment sets", await callFn("assortment-admin", { action: "list-sets" }, token)).sets || [];
  let set = sets.find((row) => row.name === "Pilot 판교 36SKU");
  if (!set) {
    set = requireOk("assortment upsert", await callFn("assortment-admin", { action: "upsert-set", name: "Pilot 판교 36SKU" }, token)).set;
  }
  const setGet = requireOk("assortment get", await callFn("assortment-admin", { action: "get-set", id: set.id }, token));
  const existingProductRules = new Set((setGet.rules || []).map((row) => row.product_id).filter(Boolean));
  for (const productId of productIds) {
    if (existingProductRules.has(productId)) continue;
    requireOk("add-rule", await callFn("assortment-admin", { action: "add-rule", assortment_set_id: set.id, product_id: productId }, token));
  }

  const prepItems = [
    ["Pilot 랙", "EQUIPMENT", "개"],
    ["Pilot 조명", "EQUIPMENT", "세트"],
    ["Pilot 멀티탭", "EQUIPMENT", "개"],
    ["Pilot 카드단말기", "EQUIPMENT", "대"],
    ["Pilot 쇼핑백", "CONSUMABLE", "개"],
  ];
  const itemIds = {};
  for (const [name, item_type, default_unit] of prepItems) {
    const upserted = requireOk(`prep ${name}`, await callFn("prep-admin", { action: "upsert-item", name, item_type, default_unit }, token));
    itemIds[name] = upserted.item.id;
  }
  const prepSets = requireOk("prep sets", await callFn("prep-admin", { action: "list-sets" }, token)).sets || [];
  let prepSet = prepSets.find((row) => row.name === "Pilot 백화점세트");
  if (!prepSet) {
    prepSet = requireOk("prep set", await callFn("prep-admin", { action: "upsert-set", name: "Pilot 백화점세트" }, token)).set;
  }
  const qtys = { "Pilot 랙": 4, "Pilot 조명": 2, "Pilot 멀티탭": 3, "Pilot 카드단말기": 1, "Pilot 쇼핑백": 200 };
  for (const [name, qty] of Object.entries(qtys)) {
    const added = await callFn(
      "prep-admin",
      { action: "add-set-item", preparation_set_id: prepSet.id, preparation_item_id: itemIds[name], planned_quantity: qty },
      token,
    );
    if (added.status !== 200 && added.json.error !== "duplicate_item") {
      throw new Error(`prep line ${name}: ${added.status} ${added.json.error}`);
    }
  }

  const locs = requireOk("locations", await callFn("inventory-movement", { action: "list-locations" }, token)).locations || [];
  let hq = locs.find((row) => row.location_type === "HQ" && row.name === "본사");
  if (!hq) {
    hq = requireOk("hq", await callFn("inventory-movement", { action: "create-location", location_type: "HQ", name: "본사" }, token)).location;
  }
  for (const variantId of uniqueVariants.slice(0, 8)) {
    const adj = await callFn(
      "inventory-movement",
      { action: "create-adjustment", location_id: hq.id, product_variant_id: variantId, full_pack_count: 6, remainder_level: "ZERO", reason: "Pilot rehearsal opening stock" },
      token,
    );
    if (adj.status !== 200 && adj.json.error !== "already_adjusted") {
      // duplicate adjustment on rerun is acceptable
      if (!String(adj.json.error || "").includes("already") && adj.status !== 409) {
        throw new Error(`adjustment ${variantId}: ${adj.status} ${adj.json.error}`);
      }
    }
  }

  const summary = {
    organizer_id: organizer.id,
    organizer_name: organizer.name,
    assortment_set_id: set.id,
    prep_set_id: prepSet.id,
    hq_location_id: hq.id,
    sku_count: uniqueVariants.length,
    variant_ids: uniqueVariants,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`seed-pilot-rehearsal ready: ${uniqueVariants.length} SKUs, organizer ${organizer.name}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
