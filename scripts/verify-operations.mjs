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

function scheduleSortRank(status, scheduleStatus) {
  if (status === "CANCELLED") return 2;
  if (scheduleStatus === "TENTATIVE") return 1;
  return 0;
}

function eventPayload(overrides = {}) {
  return {
    action: "create",
    name: "운영개선02 행사",
    venue_name: "롯데백화점 판교점",
    address: "경기도 성남시 분당구",
    starts_at: "2026-10-10T10:00:00+09:00",
    ends_at: "2026-10-12T20:00:00+09:00",
    status: "ACTIVE",
    schedule_status: "TENTATIVE",
    ...overrides,
  };
}

async function uploadSetupPhoto(authed, token, sessionId, photoType) {
  const signed = await callFn(
    "event-ops",
    {
      action: "sign-upload",
      session_id: sessionId,
      photo_type: photoType,
      original_filename: `${photoType.toLowerCase()}.png`,
      mime_type: "image/png",
      file_size: PNG.length,
    },
    token,
  );
  if (signed.status !== 200) return signed;
  const { error } = await authed.storage.from("setup-photos").uploadToSignedUrl(signed.json.storage_path, signed.json.token, PNG, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`upload ${photoType}: ${error.message}`);
  return await callFn(
    "event-ops",
    { action: "complete-upload", session_id: sessionId, storage_path: signed.json.storage_path, photo_type: photoType },
    token,
  );
}

async function main() {
  const stamp = Date.now();
  const secret = client(secretKey());
  const admin = await signIn("+821000000001");
  const staff = await signIn("+821000000002");
  const partTimer = await signIn("+821000000005");

  const org = await callFn(
    "organizer-admin",
    { action: "create", name: `운영주최-${stamp}`, calendar_color: "#2563EB" },
    admin.session.access_token,
  );
  await expect("organizer for ops events", org.status === 200 && Boolean(org.json.organizer?.id), org.json.error);
  const orgId = org.json.organizer.id;

  const tentative = await callFn(
    "event-admin",
    eventPayload({ name: `예정행사-${stamp}`, organizer_id: orgId, schedule_status: "TENTATIVE" }),
    admin.session.access_token,
  );
  await expect("1 TENTATIVE 생성", tentative.status === 200 && tentative.json.event?.schedule_status === "TENTATIVE", tentative.json.error);
  await expect("event_status unchanged", tentative.json.event.status === "ACTIVE");
  const eventA = tentative.json.event.id;

  const asConfirmed = await callFn(
    "event-admin",
    { action: "set-schedule-status", id: eventA, schedule_status: "CONFIRMED" },
    admin.session.access_token,
  );
  await expect("2 CONFIRMED 변경", asConfirmed.status === 200 && asConfirmed.json.event.schedule_status === "CONFIRMED", asConfirmed.json.error);

  const stillTentativeLifecycle = await callFn(
    "event-admin",
    eventPayload({
      name: `캘린더예정-${stamp}`,
      organizer_id: orgId,
      schedule_status: "TENTATIVE",
      starts_at: "2026-10-20T10:00:00+09:00",
      ends_at: "2026-10-20T20:00:00+09:00",
    }),
    admin.session.access_token,
  );
  const confirmedSameDay = await callFn(
    "event-admin",
    eventPayload({
      name: `캘린더확정-${stamp}`,
      organizer_id: orgId,
      schedule_status: "CONFIRMED",
      starts_at: "2026-10-20T11:00:00+09:00",
      ends_at: "2026-10-20T21:00:00+09:00",
    }),
    admin.session.access_token,
  );
  const cancelledSameDay = await callFn(
    "event-admin",
    eventPayload({
      name: `캘린더취소-${stamp}`,
      organizer_id: orgId,
      schedule_status: "CONFIRMED",
      status: "CANCELLED",
      starts_at: "2026-10-20T12:00:00+09:00",
      ends_at: "2026-10-20T18:00:00+09:00",
    }),
    admin.session.access_token,
  );
  await expect("calendar fixtures", stillTentativeLifecycle.status === 200 && confirmedSameDay.status === 200 && cancelledSameDay.status === 200);

  const badLifecycle = await callFn(
    "event-admin",
    eventPayload({ name: `잘못된상태-${stamp}`, organizer_id: orgId, status: "TENTATIVE" }),
    admin.session.access_token,
  );
  await expect("TENTATIVE is not event_status", badLifecycle.status === 400);

  const cal = await callFn(
    "event-admin",
    { action: "calendar", from: "2026-10-01T00:00:00+09:00", to: "2026-10-31T23:59:59+09:00" },
    admin.session.access_token,
  );
  const dayRows = (cal.json.events || []).filter((row) =>
    [stillTentativeLifecycle.json.event.id, confirmedSameDay.json.event.id, cancelledSameDay.json.event.id].includes(row.id),
  );
  const sorted = [...dayRows].sort(
    (a, b) => scheduleSortRank(a.status, a.schedule_status) - scheduleSortRank(b.status, b.schedule_status),
  );
  await expect("3 예정 schedule_status", dayRows.some((row) => row.id === stillTentativeLifecycle.json.event.id && row.schedule_status === "TENTATIVE"));
  await expect("4 확정 Organizer 색", dayRows.some((row) => row.id === confirmedSameDay.json.event.id && row.organizer_color === "#2563EB" && row.schedule_status === "CONFIRMED"));
  await expect(
    "5 정렬 CONFIRMED → TENTATIVE → CANCELLED",
    sorted.map((row) => row.id).join(",") ===
      [confirmedSameDay.json.event.id, stillTentativeLifecycle.json.event.id, cancelledSameDay.json.event.id].join(","),
    sorted.map((row) => `${row.schedule_status}/${row.status}`).join(","),
  );
  const confirmedOnly = dayRows.filter((row) => row.schedule_status === "CONFIRMED" && row.status !== "CANCELLED");
  await expect("5 필터 확정", confirmedOnly.every((row) => row.schedule_status === "CONFIRMED") && confirmedOnly.length === 1);

  await callFn("event-admin", { action: "add-member", event_id: eventA, profile_id: staff.user.id, assignment_role: "STAFF" }, admin.session.access_token);
  await callFn("event-admin", { action: "add-member", event_id: eventA, profile_id: partTimer.user.id, assignment_role: "PART_TIMER" }, admin.session.access_token);

  const eventB = await callFn(
    "event-admin",
    eventPayload({
      name: `다음행사-${stamp}`,
      venue_name: "현대백화점 판교점",
      organizer_id: orgId,
      schedule_status: "CONFIRMED",
      starts_at: "2026-10-13T10:00:00+09:00",
      ends_at: "2026-10-15T20:00:00+09:00",
    }),
    admin.session.access_token,
  );
  await expect("event B created", eventB.status === 200, eventB.json.error);
  const eventBId = eventB.json.event.id;

  const plan = await callFn(
    "event-ops",
    {
      action: "save-plan",
      event_id: eventA,
      planned_start_at: "2026-10-09T18:00:00+09:00",
      planned_end_at: "2026-10-09T21:00:00+09:00",
      planned_staff_count: 4,
      setup_notes: "하역 후 테이블 먼저",
    },
    admin.session.access_token,
  );
  await expect("11 계획 생성", plan.status === 200 && plan.json.session?.status === "PLANNED" && plan.json.session.planned_staff_count === 4, plan.json.error);
  const sessionId = plan.json.session.id;

  const members = await callFn(
    "event-ops",
    { action: "set-members", setup_session_id: sessionId, members: [{ profile_id: staff.user.id, role: "LEAD" }, { profile_id: partTimer.user.id, role: "MEMBER" }] },
    admin.session.access_token,
  );
  await expect("Setup Members LEAD/MEMBER", members.status === 200 && (members.json.members || []).length === 2, members.json.error);

  const { data: prepItems } = await secret.from("preparation_items").select("id, name").limit(1);
  const prepId = prepItems?.[0]?.id ?? null;
  const originalPrepName = prepItems?.[0]?.name ?? null;

  const table = await callFn(
    "event-ops",
    {
      action: "add-fixture",
      setup_session_id: sessionId,
      fixture_type: "TABLE",
      name_snapshot: originalPrepName || "1800 테이블",
      preparation_item_id: prepId,
      width_mm: 1800,
      depth_mm: 750,
      height_mm: 720,
      planned_quantity: 4,
    },
    admin.session.access_token,
  );
  await expect("6 TABLE 등록", table.status === 200 && table.json.fixture?.fixture_type === "TABLE", table.json.error);
  await expect("7 1800mm × 4 → 7.2m", table.json.summary?.planned_table_frontage_m === 7.2, JSON.stringify(table.json.summary));
  const tableId = table.json.fixture.id;

  const actualQty = await callFn("event-ops", { action: "update-fixture", id: tableId, actual_quantity: 3 }, staff.session.access_token);
  await expect("8 계획 4 / 실제 3", actualQty.status === 200 && actualQty.json.fixture.planned_quantity === 4 && actualQty.json.fixture.actual_quantity === 3, actualQty.json.error);

  const rack = await callFn(
    "event-ops",
    {
      action: "add-fixture",
      setup_session_id: sessionId,
      fixture_type: "RACK",
      name_snapshot: "양말렉",
      width_mm: 900,
      depth_mm: 450,
      height_mm: 1800,
      planned_quantity: 6,
      rack_levels: 5,
    },
    admin.session.access_token,
  );
  await expect("9 RACK 6 × 5단 → 총 30단", rack.status === 200 && rack.json.summary?.planned_total_rack_levels === 30 && rack.json.summary?.planned_rack_count === 6, JSON.stringify(rack.json.summary));

  if (prepId) {
    await secret.from("preparation_items").update({ name: `준비마스터변경-${stamp}` }).eq("id", prepId);
    const afterPrep = await secret.from("event_setup_fixtures").select("name_snapshot").eq("id", tableId).single();
    await expect("10 Preparation Snapshot 불변", afterPrep.data?.name_snapshot === (originalPrepName || "1800 테이블"));
    await secret.from("preparation_items").update({ name: originalPrepName }).eq("id", prepId);
  } else {
    await expect("10 Preparation Snapshot 불변", table.json.fixture.name_snapshot === "1800 테이블");
  }

  const other = await callFn(
    "event-ops",
    { action: "add-fixture", setup_session_id: sessionId, fixture_type: "SIGNAGE", name_snapshot: "입간판", planned_quantity: 5 },
    admin.session.access_token,
  );
  await expect("기타 집기 5개", other.status === 200 && other.json.summary?.other_planned_count === 5, JSON.stringify(other.json.summary));

  const arrival = await uploadSetupPhoto(staff.supabase, staff.session.access_token, sessionId, "ARRIVAL");
  await expect("12 도착사진", arrival.status === 200 && arrival.json.photo?.photo_type === "ARRIVAL", arrival.json.error);
  await expect("13 서버시간 도착", Boolean(arrival.json.session?.arrival_recorded_at) && arrival.json.session.status === "ARRIVED");
  const rawArrival = arrival.json.session.arrival_recorded_at;
  const arrivalSkewMs = Math.abs(Date.parse(rawArrival) - Date.now());
  await expect("13 도착 timestamp는 서버 now", arrivalSkewMs < 120000, String(arrivalSkewMs));

  const completion = await uploadSetupPhoto(staff.supabase, staff.session.access_token, sessionId, "COMPLETION");
  await expect("14 완료사진", completion.status === 200 && completion.json.session?.status === "COMPLETED", completion.json.error);
  const rawCompleted = completion.json.session.completed_recorded_at;
  await expect("15 소요시간 계산", completion.json.session.duration_minutes != null && completion.json.session.duration_minutes >= 0);

  const actuals = await callFn(
    "event-ops",
    { action: "save-actuals", session_id: sessionId, actual_staff_count: 3, actual_notes: "한 명 지각" },
    staff.session.access_token,
  );
  await expect("실제 인원 3", actuals.status === 200 && actuals.json.session.actual_staff_count === 3, actuals.json.error);

  const adjustedArrival = new Date(Date.parse(rawArrival) - 12 * 60000).toISOString();
  const adjust = await callFn(
    "event-ops",
    {
      action: "adjust-times",
      session_id: sessionId,
      adjusted_arrival_at: adjustedArrival,
      adjustment_reason: "도착 후 하역부터 하고 12분 뒤 촬영",
    },
    admin.session.access_token,
  );
  await expect("16 관리자 보정", adjust.status === 200 && adjust.json.session.adjusted_arrival_at, adjust.json.error);
  await expect("15 보정 후 세팅시간", adjust.json.session.duration_minutes >= 12, String(adjust.json.session.duration_minutes));

  const rawAfter = await secret.from("event_setup_sessions").select("arrival_recorded_at, completed_recorded_at").eq("id", sessionId).single();
  await expect("17 Raw 불변", rawAfter.data.arrival_recorded_at === rawArrival && rawAfter.data.completed_recorded_at === rawCompleted);

  const mutateRaw = await secret
    .from("event_setup_sessions")
    .update({ arrival_recorded_at: new Date().toISOString() })
    .eq("id", sessionId)
    .select();
  await expect("17 trigger raw_timestamp_immutable", Boolean(mutateRaw.error?.message?.includes("raw_timestamp_immutable")), mutateRaw.error?.message);

  const audit = await secret.from("audit_logs").select("*").eq("entity_type", "SETUP_SESSION").eq("entity_id", sessionId);
  await expect(
    "18 Audit",
    (audit.data || []).some(
      (row) =>
        row.actor_profile_id === admin.user.id &&
        row.reason?.includes("하역") &&
        row.after_data?.adjustment_reason,
    ),
    JSON.stringify(audit.data?.[0] || audit.error),
  );

  const staffRaw = await staff.supabase.from("event_setup_sessions").update({ arrival_recorded_at: new Date().toISOString() }).eq("id", sessionId).select();
  await expect("19 STAFF raw 수정 거부", Boolean(staffRaw.error) || (staffRaw.data || []).length === 0);

  const staffAdjust = await callFn(
    "event-ops",
    { action: "adjust-times", session_id: sessionId, adjusted_arrival_at: adjustedArrival, adjustment_reason: "직원시도" },
    staff.session.access_token,
  );
  const partAdjust = await callFn(
    "event-ops",
    { action: "adjust-times", session_id: sessionId, adjusted_arrival_at: adjustedArrival, adjustment_reason: "알바시도" },
    partTimer.session.access_token,
  );
  await expect("19 STAFF 보정 거부", staffAdjust.status === 403);
  await expect("20 PART_TIMER 보정 거부", partAdjust.status === 403);

  const staffPlan = await callFn("event-ops", { action: "save-plan", event_id: eventA, planned_staff_count: 9 }, staff.session.access_token);
  await expect("STAFF 계획 수정 거부", staffPlan.status === 403);

  const unassigned = await callFn("event-ops", { action: "get-setup", event_id: eventBId }, staff.session.access_token);
  await expect("21 미배정 사용자 접근거부", unassigned.status === 404);

  const ilsan = await callFn(
    "event-ops",
    { action: "create-location", name: `일산사무실-${stamp}`, location_type: "OFFICE", address: "경기 고양시" },
    admin.session.access_token,
  );
  const sadang = await callFn(
    "event-ops",
    { action: "create-location", name: `사당집-${stamp}`, location_type: "HOME_BASE" },
    admin.session.access_token,
  );
  const busan = await callFn(
    "event-ops",
    { action: "create-location", name: `부산숙소-${stamp}`, location_type: "LODGING" },
    admin.session.access_token,
  );
  await expect("22 고정거점 생성", ilsan.status === 200 && sadang.status === 200 && busan.status === 200, ilsan.json.error);
  const ilsanId = ilsan.json.location.id;
  const sadangId = sadang.json.location.id;
  const busanId = busan.json.location.id;

  const staffLoc = await callFn("event-ops", { action: "create-location", name: `직원거점-${stamp}`, location_type: "OTHER" }, staff.session.access_token);
  await expect("STAFF 거점 생성 거부", staffLoc.status === 403);

  const deactivate = await callFn("event-ops", { action: "update-location", id: ilsanId, is_active: false }, admin.session.access_token);
  await expect("23 비활성화", deactivate.status === 200 && deactivate.json.location.is_active === false, deactivate.json.error);

  const aToB = await callFn(
    "event-ops",
    {
      action: "save-transition",
      from_event_id: eventA,
      to_event_id: eventBId,
      movement_subject: "BOTH",
      planned_departure_at: "2026-10-12T21:00:00+09:00",
      planned_arrival_at: "2026-10-12T22:30:00+09:00",
    },
    admin.session.access_token,
  );
  await expect("25 Event→Event", aToB.status === 200 && aToB.json.transition?.movement_subject === "BOTH", aToB.json.error);

  const aToOffice = await callFn(
    "event-ops",
    {
      action: "save-transition",
      from_event_id: eventA,
      to_operation_location_id: ilsanId,
      movement_subject: "GEAR",
      planned_departure_at: "2026-10-12T21:00:00+09:00",
      planned_arrival_at: "2026-10-12T23:00:00+09:00",
    },
    admin.session.access_token,
  );
  await expect("26 Event→Operation Location GEAR", aToOffice.status === 200 && aToOffice.json.transition.movement_subject === "GEAR", aToOffice.json.error);

  const crewHome = await callFn(
    "event-ops",
    {
      action: "save-transition",
      from_event_id: eventA,
      to_operation_location_id: sadangId,
      movement_subject: "CREW",
      planned_departure_at: "2026-10-12T21:30:00+09:00",
      planned_arrival_at: "2026-10-12T22:20:00+09:00",
    },
    admin.session.access_token,
  );
  const overnightHomeToLodge = await callFn(
    "event-ops",
    {
      action: "save-transition",
      from_operation_location_id: sadangId,
      to_operation_location_id: busanId,
      movement_subject: "CREW",
      planned_departure_at: "2026-10-12T23:00:00+09:00",
      planned_arrival_at: "2026-10-13T06:00:00+09:00",
    },
    admin.session.access_token,
  );
  const lodgeToB = await callFn(
    "event-ops",
    {
      action: "save-transition",
      from_operation_location_id: busanId,
      to_event_id: eventBId,
      movement_subject: "CREW",
      planned_departure_at: "2026-10-13T08:00:00+09:00",
      planned_arrival_at: "2026-10-13T09:30:00+09:00",
    },
    admin.session.access_token,
  );
  const officeToB = await callFn(
    "event-ops",
    {
      action: "save-transition",
      from_operation_location_id: ilsanId,
      to_event_id: eventBId,
      movement_subject: "BOTH",
      planned_departure_at: "2026-10-13T06:00:00+09:00",
      planned_arrival_at: "2026-10-13T09:00:00+09:00",
    },
    admin.session.access_token,
  );
  await expect("27 Operation Location→Event", lodgeToB.status === 200 && officeToB.status === 200, lodgeToB.json.error || officeToB.json.error);
  await expect("28 GEAR/CREW/BOTH", aToOffice.json.transition.movement_subject === "GEAR" && crewHome.json.transition.movement_subject === "CREW" && officeToB.json.transition.movement_subject === "BOTH");
  await expect(
    "29 Overnight multi-leg",
    crewHome.status === 200 && overnightHomeToLodge.status === 200 && lodgeToB.status === 200,
    overnightHomeToLodge.json.error,
  );

  const afterDeactivate = await secret.from("event_transition_legs").select("id").eq("id", aToOffice.json.transition.id).single();
  await expect("24 과거 이동 유지", afterDeactivate.data?.id === aToOffice.json.transition.id);

  const xorFail = await callFn(
    "event-ops",
    { action: "save-transition", from_event_id: eventA, from_operation_location_id: sadangId, to_event_id: eventBId, movement_subject: "GEAR" },
    admin.session.access_token,
  );
  await expect("XOR endpoint 거부", xorFail.status === 400);

  const sameFail = await callFn(
    "event-ops",
    { action: "save-transition", from_event_id: eventA, to_event_id: eventA, movement_subject: "GEAR" },
    admin.session.access_token,
  );
  await expect("source != destination", sameFail.status === 400);

  const buckets = await secret.storage.listBuckets();
  await expect("setup-photos bucket", (buckets.data || []).some((row) => row.id === "setup-photos"), buckets.error?.message);

  const getSetup = await callFn("event-ops", { action: "get-setup", event_id: eventA }, admin.session.access_token);
  await expect(
    "AI raw context fields present",
    getSetup.json.summary?.planned_table_count === 4 &&
      getSetup.json.summary?.planned_table_frontage_m === 7.2 &&
      getSetup.json.session?.arrival_recorded_at &&
      getSetup.json.session?.adjusted_arrival_at &&
      getSetup.json.session?.actual_staff_count === 3,
    JSON.stringify({ summary: getSetup.json.summary, session: getSetup.json.session }),
  );

  console.log("verify:operations passed.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
