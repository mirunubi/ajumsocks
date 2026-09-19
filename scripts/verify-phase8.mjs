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

function finance(token, body) {
  return callFn("event-finance", body, token);
}

async function expect(name, ok, extra = "") {
  if (!ok) throw new Error(`FAIL ${name}${extra ? `: ${extra}` : ""}`);
  console.log(`PASS ${name}`);
}

function n(value) {
  return Number(value);
}

function eventPayload(name, venue, extra = {}) {
  return {
    action: "create",
    name,
    venue_name: venue,
    address: "서울시 테스트로 1",
    starts_at: "2026-09-20T09:00:00+09:00",
    ends_at: "2026-09-25T21:00:00+09:00",
    status: "ACTIVE",
    contract_type: "NONE",
    ...extra,
  };
}

async function uploadReceipt(token, eventId, expenseId, filename) {
  const signed = await finance(token, {
    action: "sign-receipt-upload",
    event_id: eventId,
    expense_id: expenseId,
    original_filename: filename,
    mime_type: "image/png",
    file_size: PNG.length,
  });
  if (signed.status !== 200) return signed;
  const authed = createClient(apiUrl(), publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { error } = await authed.storage
    .from("expense-receipts")
    .uploadToSignedUrl(signed.json.storage_path, signed.json.token, PNG, {
      contentType: "image/png",
      upsert: true,
    });
  if (error) return { status: 400, json: { error: error.message } };
  return finance(token, {
    action: "complete-receipt-upload",
    event_id: eventId,
    expense_id: expenseId,
    storage_path: signed.json.storage_path,
    original_filename: filename,
    mime_type: "image/png",
    file_size: PNG.length,
  });
}

async function main() {
  const publishable = client(publishableKey());
  const secret = client(secretKey());
  const sql = readFileSync("supabase/migrations/20260919200000_event_finance.sql", "utf8");
  await expect(
    "42 Phase 8에 발주/POS/자동원가 없음",
    !/create table public\.(purchase_orders|shipments|suppliers)\b/i.test(sql) &&
      !/double precision|real\b|float/i.test(sql) &&
      /numeric\(14, 0\)/.test(sql),
  );

  const signup = await publishable.auth.signUp({ email: "uninvited-p8@example.com", password: PASSWORD });
  await expect("40 public signUp rejected", Boolean(signup.error));

  const master = await signIn("+821000000001");
  const staff = await signIn("+821000000002");
  const partTimer = await signIn("+821000000005");
  const expired = await signIn("+821000000004");
  const token = master.session.access_token;

  let cats = { status: 0, json: {} };
  for (let i = 0; i < 8; i += 1) {
    cats = await finance(token, { action: "list-categories" });
    if (cats.status === 200) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  await expect("11 지출 Category 초기값", cats.status === 200 && (cats.json.categories || []).length >= 8, cats.json.error);
  const parking = (cats.json.categories || []).find((row) => row.code === "PARKING");
  const food = (cats.json.categories || []).find((row) => row.code === "FOOD");

  const created = await finance(token, {
    action: "upsert-category",
    code: "TEST_FEE",
    name: "테스트수수료",
    sort_order: 99,
  });
  await expect("11 지출 Category 생성", created.status === 200 && created.json.category?.code === "TEST_FEE", created.json.error);
  const staffCat = await finance(staff.session.access_token, {
    action: "upsert-category",
    code: "STAFF_CAT",
    name: "직원분류",
  });
  await expect("12 STAFF Category 관리 거부", staffCat.status === 403);
  const staffCatInsert = await staff.supabase.from("expense_categories").insert({ code: "HACK", name: "해킹" });
  await expect("12 STAFF Category 직접 INSERT 거부", Boolean(staffCatInsert.error));

  const eventA = await callFn("event-admin", eventPayload("판교 행사", "판교", { contract_type: "COMMISSION", commission_rate: 20 }), token);
  const eventB = await callFn("event-admin", eventPayload("수원 행사", "수원"), token);
  if (eventA.status !== 200) throw new Error(`A: ${eventA.json.error}`);
  if (eventB.status !== 200) throw new Error(`B: ${eventB.json.error}`);
  const aId = eventA.json.event.id;
  const bId = eventB.json.event.id;

  await callFn("event-admin", { action: "add-member", event_id: aId, profile_id: staff.user.id, assignment_role: "STAFF" }, token);
  await callFn(
    "event-admin",
    { action: "add-member", event_id: aId, profile_id: partTimer.user.id, assignment_role: "PART_TIMER" },
    token,
  );

  const posBefore = await secret.from("inventory_positions").select("id, estimated_units");
  const posBeforeKey = JSON.stringify((posBefore.data || []).map((row) => [row.id, String(row.estimated_units)]).sort());

  const adminSale = await finance(token, {
    action: "save-daily-sales",
    event_id: aId,
    business_date: "2026-09-20",
    card_amount: 1200000,
    cash_amount: 180000,
    other_amount: 20000,
    memo: "개장일",
  });
  await expect(
    "1 ADMIN 일매출 입력",
    adminSale.status === 200 && n(adminSale.json.sale.card_amount) === 1200000,
    adminSale.json.error,
  );
  await expect(
    "6 일매출 합계는 계산값",
    n(adminSale.json.sale.card_amount) + n(adminSale.json.sale.cash_amount) + n(adminSale.json.sale.other_amount) === 1400000,
  );

  const staffSale = await finance(staff.session.access_token, {
    action: "save-daily-sales",
    event_id: aId,
    business_date: "2026-09-21",
    card_amount: 500000,
    cash_amount: 0,
    other_amount: 0,
  });
  await expect("2 배정 STAFF 일매출 입력", staffSale.status === 200, staffSale.json.error);

  const partSale = await finance(partTimer.session.access_token, {
    action: "save-daily-sales",
    event_id: aId,
    business_date: "2026-09-22",
    card_amount: 0,
    cash_amount: 0,
    other_amount: 0,
  });
  await expect("3 배정 PART_TIMER 일매출 입력", partSale.status === 200, partSale.json.error);

  const unassigned = await finance(staff.session.access_token, {
    action: "save-daily-sales",
    event_id: bId,
    business_date: "2026-09-20",
    card_amount: 1000,
    cash_amount: 0,
    other_amount: 0,
  });
  await expect("4 미배정 사용자 입력 거부", unassigned.status === 403);

  const outOfRange = await finance(token, {
    action: "save-daily-sales",
    event_id: aId,
    business_date: "2026-09-19",
    card_amount: 1,
    cash_amount: 0,
    other_amount: 0,
  });
  await expect("5 기간 밖 매출일 거부", outOfRange.status === 400 && outOfRange.json.error === "date_out_of_range", outOfRange.json.error);

  const negative = await finance(token, {
    action: "save-daily-sales",
    event_id: aId,
    business_date: "2026-09-23",
    card_amount: -1,
    cash_amount: 0,
    other_amount: 0,
  });
  const frac = await finance(token, {
    action: "save-daily-sales",
    event_id: aId,
    business_date: "2026-09-23",
    card_amount: 1.5,
    cash_amount: 0,
    other_amount: 0,
  });
  await expect(
    "6 카드/현금/기타 금액 validation",
    negative.status === 400 && negative.json.error === "invalid_amount" && frac.status === 400 && frac.json.error === "invalid_amount",
  );

  const salesA = await finance(token, { action: "get-sales", event_id: aId });
  const days = salesA.json.days || [];
  const d20 = days.find((row) => row.business_date === "2026-09-20");
  const d22 = days.find((row) => row.business_date === "2026-09-22");
  const d23 = days.find((row) => row.business_date === "2026-09-23");
  await expect("7 매출 미입력과 0원 구분", d22?.status === "zero" && d23?.status === "missing" && d20?.status === "entered");
  await expect("37 일매출 입력현황 표시", Boolean(d20 && d22 && d23));
  await expect("38 0원 입력일 완료 표시", d22?.status === "zero" && n(d22.total) === 0);

  const dup = await finance(token, {
    action: "save-daily-sales",
    event_id: aId,
    business_date: "2026-09-20",
    card_amount: 1,
    cash_amount: 0,
    other_amount: 0,
  });
  await expect("8 동일 행사/날짜 중복 row 방지", dup.status === 409 && dup.json.error === "conflict", dup.json.error);

  const updated = await finance(token, {
    action: "save-daily-sales",
    event_id: aId,
    business_date: "2026-09-20",
    card_amount: 1300000,
    cash_amount: 180000,
    other_amount: 20000,
    updated_at: adminSale.json.sale.updated_at,
  });
  await expect("9 일매출 수정", updated.status === 200 && n(updated.json.sale.card_amount) === 1300000, updated.json.error);

  const conflict = await finance(token, {
    action: "save-daily-sales",
    event_id: aId,
    business_date: "2026-09-20",
    card_amount: 999,
    cash_amount: 0,
    other_amount: 0,
    updated_at: adminSale.json.sale.updated_at,
  });
  await expect("10 동시수정 충돌 검증", conflict.status === 409 && conflict.json.error === "conflict");

  const exp = await finance(token, {
    action: "create-expense",
    event_id: aId,
    expense_date: "2026-09-18",
    expense_category_id: parking.id,
    amount: 20000,
    payment_method: "CARD",
    description: "백화점 주차",
  });
  await expect("13 지출 생성", exp.status === 200 && n(exp.json.expense.amount) === 20000, exp.json.error);

  const exp2 = await finance(staff.session.access_token, {
    action: "create-expense",
    event_id: aId,
    expense_date: "2026-09-20",
    expense_category_id: food.id,
    amount: 430000,
    payment_method: "CASH",
    description: "식비",
  });
  await expect("13 STAFF 지출 생성", exp2.status === 200, exp2.json.error);

  const expUp = await finance(staff.session.access_token, {
    action: "update-expense",
    id: exp2.json.expense.id,
    event_id: aId,
    expense_date: "2026-09-20",
    expense_category_id: food.id,
    amount: 450000,
    payment_method: "CASH",
    description: "식비 수정",
    updated_at: exp2.json.expense.updated_at,
  });
  await expect("14 지출 수정", expUp.status === 200 && n(expUp.json.expense.amount) === 450000, expUp.json.error);

  const staffVoid = await finance(staff.session.access_token, { action: "void-expense", id: exp.json.expense.id });
  await expect("15 STAFF void 거부", staffVoid.status === 403);

  const voided = await finance(token, { action: "void-expense", id: exp.json.expense.id });
  await expect("15 지출 void", voided.status === 200 && Boolean(voided.json.expense.voided_at), voided.json.error);

  const r1 = await uploadReceipt(token, aId, exp2.json.expense.id, "a.png");
  const r2 = await uploadReceipt(token, aId, exp2.json.expense.id, "b.png");
  await expect("17 영수증 여러 장 업로드", r1.status === 200 && r2.status === 200, r1.json.error || r2.json.error);

  const badReceipt = await finance(staff.session.access_token, {
    action: "sign-receipt-upload",
    event_id: bId,
    expense_id: exp2.json.expense.id,
    original_filename: "x.png",
    mime_type: "image/png",
    file_size: PNG.length,
  });
  const unassignedReceipts = await staff.supabase.from("event_expense_receipts").select("id").eq("event_id", bId);
  await expect("18 미배정 사용자 영수증 접근 거부", badReceipt.status === 403 && (unassignedReceipts.data || []).length === 0);

  const beforeCost = await finance(token, { action: "get-financial-summary", event_id: aId });
  await expect(
    "21 상품원가 NULL vs 0 구분(미입력)",
    beforeCost.json.summary?.profit_ready === false && beforeCost.json.summary?.estimated_product_cost == null,
  );
  await expect("30 원가 미입력 시 손익 미완료", beforeCost.json.summary?.estimated_profit == null && beforeCost.json.summary?.profit_ready === false);

  const staffCost = await finance(staff.session.access_token, {
    action: "update-product-cost",
    event_id: aId,
    estimated_product_cost: 1,
  });
  const staffInputs = await staff.supabase.from("event_financial_inputs").select("*").eq("event_id", aId);
  await expect("20 STAFF/PART_TIMER 상품원가 접근 거부", staffCost.status === 403 && (staffInputs.data || []).length === 0);

  const zeroCost = await finance(token, { action: "update-product-cost", event_id: aId, estimated_product_cost: 0 });
  const zeroSum = await finance(token, { action: "get-financial-summary", event_id: aId });
  await expect(
    "21 상품원가 NULL vs 0 구분(0원)",
    zeroCost.status === 200 && n(zeroSum.json.summary.estimated_product_cost) === 0 && zeroSum.json.summary.profit_ready === true,
    zeroCost.json.error,
  );

  const cost = await finance(token, { action: "update-product-cost", event_id: aId, estimated_product_cost: 3100000 });
  await expect("19 예상 상품원가 ADMIN 입력", cost.status === 200 && n(cost.json.input.estimated_product_cost) === 3100000, cost.json.error);

  const noneEv = await callFn("event-admin", eventPayload("NONE 계약", "NONE"), token);
  const feeEv = await callFn("event-admin", eventPayload("FIXED 계약", "FIXED", { contract_type: "FIXED_FEE", fixed_fee: 300000 }), token);
  const mixedEv = await callFn(
    "event-admin",
    eventPayload("MIXED 계약", "MIXED", { contract_type: "MIXED", commission_rate: 20, fixed_fee: 100000 }),
    token,
  );
  const roundEv = await callFn(
    "event-admin",
    eventPayload("ROUND 계약", "ROUND", { contract_type: "COMMISSION", commission_rate: 20 }),
    token,
  );
  const noneId = noneEv.json.event.id;
  const feeId = feeEv.json.event.id;
  const mixedId = mixedEv.json.event.id;
  const roundId = roundEv.json.event.id;

  await finance(token, {
    action: "save-daily-sales",
    event_id: noneId,
    business_date: "2026-09-20",
    card_amount: 1000000,
    cash_amount: 0,
    other_amount: 0,
  });
  await finance(token, {
    action: "save-daily-sales",
    event_id: feeId,
    business_date: "2026-09-20",
    card_amount: 1000000,
    cash_amount: 0,
    other_amount: 0,
  });
  await finance(token, {
    action: "save-daily-sales",
    event_id: mixedId,
    business_date: "2026-09-20",
    card_amount: 1000000,
    cash_amount: 0,
    other_amount: 0,
  });
  await finance(token, {
    action: "save-daily-sales",
    event_id: roundId,
    business_date: "2026-09-20",
    card_amount: 3333333,
    cash_amount: 0,
    other_amount: 0,
  });
  await finance(token, { action: "update-product-cost", event_id: noneId, estimated_product_cost: 0 });
  await finance(token, { action: "update-product-cost", event_id: feeId, estimated_product_cost: 0 });
  await finance(token, { action: "update-product-cost", event_id: mixedId, estimated_product_cost: 0 });
  await finance(token, { action: "update-product-cost", event_id: roundId, estimated_product_cost: 0 });

  const noneSum = await finance(token, { action: "get-financial-summary", event_id: noneId });
  const feeSum = await finance(token, { action: "get-financial-summary", event_id: feeId });
  const mixedSum = await finance(token, { action: "get-financial-summary", event_id: mixedId });
  const roundSum = await finance(token, { action: "get-financial-summary", event_id: roundId });
  await expect(
    "22 NONE 계약 계산",
    n(noneSum.json.summary.commission_amount) === 0 && n(noneSum.json.summary.booth_fee) === 0,
  );
  await expect(
    "24 FIXED_FEE 계약 계산",
    n(feeSum.json.summary.commission_amount) === 0 && n(feeSum.json.summary.booth_fee) === 300000,
  );
  await expect(
    "25 MIXED 계약 계산",
    n(mixedSum.json.summary.commission_amount) === 200000 && n(mixedSum.json.summary.booth_fee) === 100000,
  );
  await expect("26 수수료 반올림", n(roundSum.json.summary.commission_amount) === 666667, String(roundSum.json.summary.commission_amount));

  const aSum = await finance(token, { action: "get-financial-summary", event_id: aId });
  const s = aSum.json.summary;
  await expect("23 COMMISSION 계약 계산", n(s.commission_amount) === n(s.sales_total) * 0.2);
  await expect("27 총매출 계산", n(s.sales_total) === n(s.card_total) + n(s.cash_total) + n(s.other_total));
  await expect("16 void 지출 손익 제외", n(s.expense_total) === 450000, String(s.expense_total));
  await expect("28 총지출 계산", n(s.expense_total) === 450000);
  const expectedProfit = n(s.sales_total) - 3100000 - 450000 - n(s.commission_amount) - n(s.booth_fee);
  await expect("29 예상 순이익 계산", s.profit_ready === true && n(s.estimated_profit) === expectedProfit, String(s.estimated_profit));

  const staffSum = await finance(staff.session.access_token, { action: "get-financial-summary", event_id: aId });
  const staffRpc = await staff.supabase.rpc("event_finance_summary", { p_event_id: aId });
  const partSum = await finance(partTimer.session.access_token, { action: "get-financial-summary", event_id: aId });
  await expect(
    "31 STAFF/PART_TIMER 순이익 접근 거부",
    staffSum.status === 200 &&
      !("estimated_profit" in (staffSum.json.summary || {})) &&
      !("estimated_product_cost" in (staffSum.json.summary || {})) &&
      !("commission_amount" in (staffSum.json.summary || {})) &&
      Boolean(staffRpc.error) &&
      partSum.status === 200 &&
      !("estimated_profit" in (partSum.json.summary || {})),
    staffSum.json.error || staffRpc.error?.message,
  );

  const logs = await finance(token, { action: "get-audit-log", event_id: aId });
  const rows = logs.json.logs || [];
  await expect("32 매출 생성 Audit", rows.some((row) => row.entity_type === "DAILY_SALES" && row.action === "CREATE"));
  await expect("33 매출 수정 Audit", rows.some((row) => row.entity_type === "DAILY_SALES" && row.action === "UPDATE"));
  await expect(
    "34 지출 수정/void Audit",
    rows.some((row) => row.entity_type === "EXPENSE" && row.action === "UPDATE") &&
      rows.some((row) => row.entity_type === "EXPENSE" && row.action === "VOID"),
  );
  await expect("35 상품원가 수정 Audit", rows.some((row) => row.entity_type === "PRODUCT_COST"));

  const staffAudit = await finance(staff.session.access_token, { action: "get-audit-log", event_id: aId });
  const staffAuditInsert = await staff.supabase.from("audit_logs").insert({
    event_id: aId,
    entity_type: "DAILY_SALES",
    entity_id: aId,
    action: "CREATE",
  });
  const staffAuditFn = await staff.supabase.rpc("save_event_daily_sales", {
    p_event_id: aId,
    p_business_date: "2026-09-24",
    p_card: 1,
    p_cash: 0,
    p_other: 0,
    p_memo: null,
    p_expected_updated_at: null,
    p_actor: staff.user.id,
  });
  await expect(
    "36 일반 사용자 Audit INSERT 거부",
    staffAudit.status === 403 && Boolean(staffAuditInsert.error) && Boolean(staffAuditFn.error),
  );

  const posAfter = await secret.from("inventory_positions").select("id, estimated_units");
  const posAfterKey = JSON.stringify((posAfter.data || []).map((row) => [row.id, String(row.estimated_units)]).sort());
  await expect("39 매출 입력으로 재고가 변하지 않음", posBeforeKey === posAfterKey);

  const stillActive = await secret.from("events").select("status").eq("id", aId).maybeSingle();
  await expect("40 SETTLED 자동변경 없음", stillActive.data?.status === "ACTIVE");

  const expiredCall = await finance(expired.session.access_token, { action: "list-categories" });
  await expect("40 기간만료 사용자 접근 실패", expiredCall.status === 403);

  const writeSales = await staff.supabase.from("event_daily_sales").update({ card_amount: 1 }).eq("event_id", aId);
  await expect("40 Client Write 차단", Boolean(writeSales.error));

  const noPo = await secret.from("purchase_orders").select("id").limit(1);
  await expect("40 Phase 0~7 regression / 발주 없음", Boolean(noPo.error));

  const dash = await finance(token, { action: "get-today-dashboard" });
  await expect("40 ADMIN today dashboard", dash.status === 200, dash.json.error);

  const jsFile = readdirSync("app/dist/assets").find((name) => name.endsWith(".js"));
  const bundle = readFileSync(`app/dist/assets/${jsFile}`, "utf8");
  await expect("43 Client bundle Secret 없음", !bundle.includes(secretKey()));

  await master.supabase.auth.signOut();
  await staff.supabase.auth.signOut();
  await partTimer.supabase.auth.signOut();
  await expired.supabase.auth.signOut();
  console.log("Phase 8 checks passed (reset/build reported separately).");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
