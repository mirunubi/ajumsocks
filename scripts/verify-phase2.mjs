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
  const headers = {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${accessToken || key}`,
  };
  const res = await fetch(`${apiUrl()}/functions/v1/${name}`, {
    method: "POST",
    headers,
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

function eventPayload(overrides = {}) {
  return {
    action: "create",
    name: "판교 현대백화점 행사",
    venue_name: "현대백화점 판교점",
    address: "경기도 성남시 분당구 판교역로 146",
    address_detail: "1층 행사장",
    starts_at: "2026-09-20T09:00:00+09:00",
    ends_at: "2026-09-25T21:00:00+09:00",
    status: "ACTIVE",
    memo: "주차 3시간 무료",
    contract_type: "COMMISSION",
    commission_rate: 20,
    ...overrides,
  };
}

async function main() {
  const publishable = client(publishableKey());
  const secret = client(secretKey());

  const signup = await publishable.auth.signUp({ email: "uninvited-p2@example.com", password: PASSWORD });
  await expect("17 public signUp rejected", Boolean(signup.error));

  const master = await signIn("+821000000001");
  const staff = await signIn("+821000000002");
  const partTimer = await signIn("+821000000005");

  const listed = await callFn("user-admin", { action: "list" }, master.session.access_token);
  await expect("17 ADMIN user-admin list", listed.status === 200, listed.json.error);
  const staffAdmin = await callFn("user-admin", { action: "list" }, staff.session.access_token);
  await expect("17 STAFF user-admin forbidden", staffAdmin.status === 403);

  const created = await callFn("event-admin", eventPayload(), master.session.access_token);
  await expect("1 ADMIN 행사 생성 성공", created.status === 200 && Boolean(created.json.event?.id), created.json.error);
  const eventId = created.json.event.id;
  const staffLoginBefore = await secret
    .from("profiles")
    .select("login_allowed_from, login_allowed_until")
    .eq("id", staff.user.id)
    .single();

  const staffCreate = await callFn("event-admin", eventPayload({ name: "직원생성" }), staff.session.access_token);
  await expect("2 STAFF 행사 생성 실패", staffCreate.status === 403);

  const partCreate = await callFn("event-admin", eventPayload({ name: "알바생성" }), partTimer.session.access_token);
  await expect("3 PART_TIMER 행사 생성 실패", partCreate.status === 403);

  const tableInsert = await staff.supabase.from("events").insert({
    name: "직접입력",
    venue_name: "불가",
    address: "서울",
    starts_at: "2026-09-20T00:00:00+09:00",
    ends_at: "2026-09-21T00:00:00+09:00",
  });
  await expect("2 STAFF table insert 실패", Boolean(tableInsert.error) || (tableInsert.data || []).length === 0);

  const other = await callFn(
    "event-admin",
    eventPayload({
      name: "수원 아울렛 행사",
      venue_name: "수원 롯데아울렛",
      address: "경기도 수원시",
      starts_at: "2026-09-28T10:00:00+09:00",
      ends_at: "2026-10-03T20:00:00+09:00",
    }),
    master.session.access_token,
  );
  const otherId = other.json.event.id;

  const assignStaff = await callFn(
    "event-admin",
    { action: "add-member", event_id: eventId, profile_id: staff.user.id, assignment_role: "STAFF" },
    master.session.access_token,
  );
  await expect("4 ADMIN 사용자 행사배정 성공", assignStaff.status === 200 && assignStaff.json.member?.profile_id === staff.user.id, assignStaff.json.error);
  await expect("4 로그인기간 자동변경 없음", assignStaff.json.login_window_unchanged === true);

  const staffLoginAfter = await secret
    .from("profiles")
    .select("login_allowed_from, login_allowed_until")
    .eq("id", staff.user.id)
    .single();
  await expect(
    "6 로그인기간 유지",
    staffLoginAfter.data.login_allowed_from === staffLoginBefore.data.login_allowed_from &&
      staffLoginAfter.data.login_allowed_until === staffLoginBefore.data.login_allowed_until,
  );

  const dup = await callFn(
    "event-admin",
    { action: "add-member", event_id: eventId, profile_id: staff.user.id, assignment_role: "MANAGER" },
    master.session.access_token,
  );
  await expect("5 같은 사용자 중복배정 방지", dup.status === 409 && dup.json.error === "duplicate_member");

  const assignPart = await callFn(
    "event-admin",
    { action: "add-member", event_id: eventId, profile_id: partTimer.user.id, assignment_role: "PART_TIMER" },
    master.session.access_token,
  );
  await expect("7 PART_TIMER 배정 성공", assignPart.status === 200, assignPart.json.error);

  const staffOwn = await staff.supabase.from("events").select("id, name").eq("id", eventId);
  await expect("6 배정 STAFF 자신의 행사 조회 성공", (staffOwn.data || []).length === 1);

  const partOwn = await partTimer.supabase.from("events").select("id").eq("id", eventId);
  await expect("7 배정 PART_TIMER 자신의 행사 조회 성공", (partOwn.data || []).length === 1);

  const staffOther = await staff.supabase.from("events").select("id").eq("id", otherId);
  await expect("8 미배정 행사 조회 실패", (staffOther.data || []).length === 0);

  const staffGetOther = await callFn("event-admin", { action: "get", id: otherId }, staff.session.access_token);
  await expect("9 URL 직접입력으로 타 행사 접근 실패", staffGetOther.status === 404);

  const contacts = [];
  for (const row of [
    { contact_type: "VENUE", name: "행사장 담당자 김", phone: "031-111-1111", company: "현대백화점" },
    { contact_type: "VENUE", name: "행사장 담당자 이", phone: "031-111-2222" },
    { contact_type: "HQ", name: "본사 담당자 박", phone: "02-222-2222", company: "현대백화점 본사" },
    { contact_type: "OTHER", name: "협력 담당 최", phone: "010-3333-3333" },
  ]) {
    contacts.push(await callFn("event-admin", { action: "add-contact", event_id: eventId, ...row }, master.session.access_token));
  }
  await expect(
    "10 외부담당자 여러 명 등록 성공",
    contacts.every((row) => row.status === 200),
    contacts.map((row) => row.json.error).filter(Boolean).join(", "),
  );

  const metaRows = Array.from({ length: 21 }, (_, index) => ({
    event_id: eventId,
    storage_path: `${eventId}/meta-${index + 1}.jpg`,
    original_filename: `meta-${index + 1}.jpg`,
    mime_type: "image/jpeg",
    file_size: 1024 + index,
    caption: `테스트 ${index + 1}`,
    photo_type: "location",
    uploaded_by: master.user.id,
  }));
  const { error: metaError } = await secret.from("event_photos").insert(metaRows);
  await expect("11 행사사진 20장 이상 metadata 처리 가능", !metaError, metaError?.message);
  const staffPhotos = await staff.supabase.from("event_photos").select("id").eq("event_id", eventId);
  await expect("11 배정 STAFF metadata 조회", (staffPhotos.data || []).length >= 21);

  const unassignedPhotos = await staff.supabase.from("event_photos").select("id").eq("event_id", otherId);
  await expect("13 미배정 사용자의 사진 조회 실패", (unassignedPhotos.data || []).length === 0);

  const badSign = await callFn(
    "event-photos",
    { action: "sign-upload", event_id: otherId, original_filename: "a.png", mime_type: "image/png", file_size: PNG.length },
    staff.session.access_token,
  );
  await expect("12 미배정 사진 업로드 거부", badSign.status === 403);

  const signed = await callFn(
    "event-photos",
    { action: "sign-upload", event_id: eventId, original_filename: "spot.png", mime_type: "image/png", file_size: PNG.length },
    staff.session.access_token,
  );
  await expect("12 배정 STAFF 업로드 권한", signed.status === 200, signed.json.error);
  const uploaded = await staff.supabase.storage
    .from("event-photos")
    .uploadToSignedUrl(signed.json.storage_path, signed.json.token, PNG, {
      contentType: "image/png",
      upsert: true,
    });
  await expect("12 Storage PUT 성공", !uploaded.error, uploaded.error?.message);
  const completed = await callFn(
    "event-photos",
    {
      action: "complete-upload",
      event_id: eventId,
      storage_path: signed.json.storage_path,
      original_filename: "spot.png",
      mime_type: "image/png",
      file_size: PNG.length,
      caption: "매대 위치",
      photo_type: "booth",
    },
    staff.session.access_token,
  );
  await expect("12 complete-upload 성공", completed.status === 200 && Boolean(completed.json.photo?.id), completed.json.error);

  const staffDelete = await callFn("event-photos", { action: "delete", id: completed.json.photo.id }, staff.session.access_token);
  await expect("12 STAFF 사진 삭제 거부", staffDelete.status === 403);

  const adminDelete = await callFn("event-photos", { action: "delete", id: completed.json.photo.id }, master.session.access_token);
  await expect("11 ADMIN 사진 삭제 성공", adminDelete.status === 200, adminDelete.json.error);
  const afterDelete = await secret.from("event_photos").select("id").eq("id", completed.json.photo.id);
  await expect("11 DB row 삭제됨", (afterDelete.data || []).length === 0);

  const mixedBad = await callFn(
    "event-admin",
    eventPayload({ name: "계약오류", contract_type: "MIXED", commission_rate: 10, fixed_fee: null }),
    master.session.access_token,
  );
  await expect("14 수수료/입점비 validation", mixedBad.status === 400 && mixedBad.json.error === "invalid_contract");

  const rangeBad = await callFn(
    "event-admin",
    eventPayload({ name: "기간오류", starts_at: "2026-09-25T12:00:00+09:00", ends_at: "2026-09-20T12:00:00+09:00" }),
    master.session.access_token,
  );
  await expect("15 종료일 < 시작일 거부", rangeBad.status === 400 && rangeBad.json.error === "invalid_range");

  const cancelled = await callFn(
    "event-admin",
    { action: "set-status", id: eventId, status: "CANCELLED" },
    master.session.access_token,
  );
  await expect("16 CANCELLED 변경", cancelled.status === 200 && cancelled.json.event.status === "CANCELLED", cancelled.json.error);
  const history = await staff.supabase.from("events").select("id, status").eq("id", eventId).single();
  const members = await staff.supabase.from("event_members").select("id").eq("event_id", eventId);
  await expect("16 CANCELLED 행사 이력 유지", history.data?.status === "CANCELLED" && (members.data || []).length >= 2);

  const buckets = await secret.storage.listBuckets();
  await expect("10 bucket event-photos", (buckets.data || []).some((row) => row.id === "event-photos"), buckets.error?.message);

  const jsFile = readdirSync("app/dist/assets").find((name) => name.endsWith(".js"));
  const bundle = readFileSync(`app/dist/assets/${jsFile}`, "utf8");
  await expect("20 Client bundle에 Secret 없음", !bundle.includes(secretKey()));

  await master.supabase.auth.signOut();
  await staff.supabase.auth.signOut();
  await partTimer.supabase.auth.signOut();
  console.log("Phase 2 checks passed (reset/build reported separately).");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
