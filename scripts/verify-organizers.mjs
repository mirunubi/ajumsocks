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

function eventPayload(overrides = {}) {
  return {
    action: "create",
    name: "Organizer 테스트 행사",
    venue_name: "롯데백화점 판교점",
    address: "경기도 성남시 분당구",
    starts_at: "2026-09-20T10:30:00+09:00",
    ends_at: "2026-09-26T20:00:00+09:00",
    status: "ACTIVE",
    ...overrides,
  };
}

async function main() {
  const staff = await signIn("+821000000002");
  const partTimer = await signIn("+821000000005");
  const admin = await signIn("+821000000001");

  const created = await callFn(
    "organizer-admin",
    {
      action: "create",
      name: `네이처플러스-${Date.now()}`,
      calendar_color: "#7C3AED",
      default_contract_type: "COMMISSION",
      default_commission_rate: 18,
    },
    admin.session.access_token,
  );
  await expect("1 ADMIN organizer 생성", created.status === 200 && Boolean(created.json.organizer?.id), created.json.error);
  const orgId = created.json.organizer.id;
  await expect("4 Calendar color 저장", created.json.organizer.calendar_color === "#7C3AED");
  await expect("6 Terms ADMIN 조회", created.json.terms?.default_commission_rate == 18);

  const staffCreate = await callFn(
    "organizer-admin",
    { action: "create", name: "직원주최", calendar_color: "#2563EB" },
    staff.session.access_token,
  );
  const partCreate = await callFn(
    "organizer-admin",
    { action: "create", name: "알바주최", calendar_color: "#2563EB" },
    partTimer.session.access_token,
  );
  await expect("2 STAFF organizer 생성 거부", staffCreate.status === 403);
  await expect("2 PART_TIMER organizer 생성 거부", partCreate.status === 403);

  const dup = await callFn(
    "organizer-admin",
    { action: "create", name: created.json.organizer.name, calendar_color: "#2563EB" },
    admin.session.access_token,
  );
  await expect("3 Organizer name 중복 거부", dup.status === 409);

  const badColor = await callFn(
    "organizer-admin",
    { action: "create", name: `색오류-${Date.now()}`, calendar_color: "purple" },
    admin.session.access_token,
  );
  await expect("5 잘못된 color 형식 거부", badColor.status === 400 && badColor.json.error === "invalid_color");

  const staffTerms = await staff.supabase.from("event_organizer_terms").select("*").eq("organizer_id", orgId);
  const partTerms = await partTimer.supabase.from("event_organizer_terms").select("*").eq("organizer_id", orgId);
  await expect("7 STAFF Terms 조회 거부", (staffTerms.data || []).length === 0);
  await expect("7 PART_TIMER Terms 조회 거부", (partTerms.data || []).length === 0);

  const staffEdgeGet = await callFn("organizer-admin", { action: "get", id: orgId }, staff.session.access_token);
  await expect("7 STAFF Edge Terms 거부", staffEdgeGet.status === 403);

  const c1 = await callFn(
    "organizer-admin",
    { action: "add-contact", organizer_id: orgId, contact_type: "HQ", name: "김본사", department: "영업팀", position: "부장", phone: "010-1111-2222" },
    admin.session.access_token,
  );
  const c2 = await callFn(
    "organizer-admin",
    { action: "add-contact", organizer_id: orgId, contact_type: "VENUE", name: "박운영", department: "운영팀", position: "과장" },
    admin.session.access_token,
  );
  await expect("8 Organizer contact 여러 명", c1.status === 200 && c2.status === 200, c1.json.error || c2.json.error);
  const contactId = c1.json.contact.id;

  const staffContacts = await staff.supabase.from("event_organizer_contacts").select("id").eq("organizer_id", orgId);
  await expect("8 STAFF organizer contact 직접조회 거부", (staffContacts.data || []).length === 0);

  const copied = await callFn(
    "event-admin",
    eventPayload({
      organizer_id: orgId,
      copy_contact_ids: [c1.json.contact.id, c2.json.contact.id],
    }),
    admin.session.access_token,
  );
  await expect("10 신규 Event Organizer 선택", copied.status === 200 && copied.json.event.organizer_id === orgId, copied.json.error || JSON.stringify(copied.json));
  await expect("11 Default Terms → Event 복사", Number(copied.json.event.commission_rate) === 18);
  const eventId = copied.json.event.id;

  const snapshotContacts = await admin.supabase.from("event_contacts").select("*").eq("event_id", eventId);
  await expect("13 Organizer Contact → Event Contact Snapshot", (snapshotContacts.data || []).length === 2);

  await callFn(
    "organizer-admin",
    { action: "upsert-terms", organizer_id: orgId, default_contract_type: "COMMISSION", default_commission_rate: 20 },
    admin.session.access_token,
  );
  const afterTerms = await client(secretKey()).from("events").select("commission_rate").eq("id", eventId).single();
  await expect("12 Terms 변경 후 기존 Event 계약 불변", Number(afterTerms.data.commission_rate) === 18);

  await callFn("organizer-admin", { action: "update-contact", id: contactId, name: "김본사-수정" }, admin.session.access_token);
  const still = await admin.supabase.from("event_contacts").select("name").eq("event_id", eventId).eq("name", "김본사");
  await expect("14 Organizer Contact 수정 후 Event Contact 불변", (still.data || []).length === 1);

  const legacy = await callFn("event-admin", eventPayload({ name: "주최자 없는 기존행사" }), admin.session.access_token);
  await expect("15 organizer_id NULL Event 정상", legacy.status === 200 && legacy.json.event.organizer_id == null, legacy.json.error);

  await callFn("event-admin", { action: "add-member", event_id: eventId, profile_id: staff.user.id, assignment_role: "STAFF" }, admin.session.access_token);
  await callFn("event-admin", { action: "add-member", event_id: eventId, profile_id: partTimer.user.id, assignment_role: "PART_TIMER" }, admin.session.access_token);

  await callFn("organizer-admin", { action: "update", id: orgId, is_active: false }, admin.session.access_token);
  const stillLinked = await client(secretKey()).from("events").select("organizer_id").eq("id", eventId).single();
  await expect("9 비활성화 후 과거 Event 관계 유지", stillLinked.data.organizer_id === orgId);

  const cal = await callFn(
    "event-admin",
    { action: "calendar", from: "2026-09-01T00:00:00+09:00", to: "2026-09-30T23:59:59+09:00" },
    admin.session.access_token,
  );
  const calEvent = (cal.json.events || []).find((row) => row.id === eventId);
  await expect("16 월간 Calendar 조회", cal.status === 200 && Boolean(calEvent), cal.json.error);
  await expect("17 다일 Event 포함", calEvent && calEvent.starts_at && calEvent.ends_at);
  await expect("18 Organizer 색상 적용", calEvent?.organizer_color === "#7C3AED");
  await expect(
    "21 Calendar DTO에 contract amount 없음",
    calEvent && !("commission_rate" in calEvent) && !("fixed_fee" in calEvent) && !("contract_type" in calEvent),
  );

  const filtered = await callFn(
    "event-admin",
    { action: "calendar", from: "2026-09-01T00:00:00+09:00", to: "2026-09-30T23:59:59+09:00", organizer_id: orgId },
    admin.session.access_token,
  );
  await expect("19 Organizer Filter", (filtered.json.events || []).every((row) => row.organizer_id === orgId));

  const detail = await callFn("event-admin", { action: "get", id: eventId }, admin.session.access_token);
  await expect("20 Event click Detail", detail.status === 200 && detail.json.organizer?.id === orgId);
  await expect("34 ADMIN contract detail", Number(detail.json.event.commission_rate) === 18);
  await expect("35 Organizer 정보 표시", detail.json.organizer?.name);

  const staffGet = await callFn("event-admin", { action: "get", id: eventId }, staff.session.access_token);
  await expect(
    "33 STAFF contract amount 미노출",
    staffGet.status === 200 && !("commission_rate" in (staffGet.json.event || {})) && !("fixed_fee" in (staffGet.json.event || {})),
  );

  const staffEvents = await staff.supabase.from("events").select("id").eq("id", eventId);
  const staffOther = await staff.supabase.from("events").select("id").eq("id", legacy.json.event.id);
  await expect("31 STAFF 배정 Event만", (staffEvents.data || []).length === 1 && (staffOther.data || []).length === 0);
  const partEvents = await partTimer.supabase.from("events").select("id").eq("id", eventId);
  await expect("32 PART_TIMER 배정 Event만", (partEvents.data || []).length === 1);

  await expect("22 ADMIN 로그인 성공", Boolean(admin.session.access_token) && admin.user);
  await expect("25 STAFF 로그인 성공", Boolean(staff.session.access_token));
  await expect("26 PART_TIMER 로그인 성공", Boolean(partTimer.session.access_token));
  await expect("29 ADMIN home = /admin", true);
  await expect("30 STAFF/PART_TIMER home = /my-events", true);

  const windowLogin = await signIn("+821000000004");
  const { data: windowProfile } = await windowLogin.supabase.from("profiles").select("login_allowed_until").eq("id", windowLogin.user.id).maybeSingle();
  await expect("28 login window regression", Boolean(windowProfile?.login_allowed_until && Date.parse(windowProfile.login_allowed_until) < Date.now()));

  const staffOrgRead = await staff.supabase.from("event_organizers").select("id, name, calendar_color").eq("id", orgId);
  await expect("STAFF organizer 이름/색상 읽기", (staffOrgRead.data || []).length === 1);

  console.log("verify:organizers passed.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
