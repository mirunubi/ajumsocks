-- MVP 운영개선 02: schedule commitment, setup sessions/fixtures, operation locations, transitions.
-- Do not edit earlier migrations. No Supplier/PO/Phase 9.

create type public.event_schedule_status as enum ('TENTATIVE', 'CONFIRMED');
create type public.setup_session_status as enum ('PLANNED', 'ARRIVED', 'COMPLETED');
create type public.setup_fixture_type as enum ('TABLE', 'RACK', 'DISPLAY', 'HANGER', 'SIGNAGE', 'OTHER');
create type public.setup_member_role as enum ('LEAD', 'MEMBER');
create type public.setup_photo_type as enum ('ARRIVAL', 'COMPLETION', 'OTHER');
create type public.operation_location_type as enum ('OFFICE', 'HOME_BASE', 'LODGING', 'STORAGE', 'OTHER');
create type public.transition_movement_subject as enum ('GEAR', 'CREW', 'BOTH');

grant usage on type public.event_schedule_status to authenticated, anon;
grant usage on type public.setup_session_status to authenticated, anon;
grant usage on type public.setup_fixture_type to authenticated, anon;
grant usage on type public.setup_member_role to authenticated, anon;
grant usage on type public.setup_photo_type to authenticated, anon;
grant usage on type public.operation_location_type to authenticated, anon;
grant usage on type public.transition_movement_subject to authenticated, anon;

alter table public.events
  add column schedule_status public.event_schedule_status not null default 'CONFIRMED';

comment on column public.events.schedule_status is 'Calendar commitment. Independent from event_status lifecycle. Existing rows backfilled CONFIRMED; new events default TENTATIVE in app create.';

alter table public.events
  alter column schedule_status set default 'TENTATIVE';

alter table public.audit_logs
  drop constraint audit_logs_entity_type_allowed;

alter table public.audit_logs
  add constraint audit_logs_entity_type_allowed check (
    entity_type in ('DAILY_SALES', 'EXPENSE', 'PRODUCT_COST', 'SETUP_SESSION')
  );

create table public.event_setup_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  status public.setup_session_status not null default 'PLANNED',
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  planned_staff_count integer,
  arrival_recorded_at timestamptz,
  completed_recorded_at timestamptz,
  adjusted_arrival_at timestamptz,
  adjusted_completed_at timestamptz,
  adjustment_reason text,
  actual_staff_count integer,
  setup_notes text,
  actual_notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint event_setup_planned_range check (
    planned_start_at is null or planned_end_at is null or planned_end_at >= planned_start_at
  ),
  constraint event_setup_planned_staff_nonneg check (planned_staff_count is null or planned_staff_count >= 0),
  constraint event_setup_actual_staff_nonneg check (actual_staff_count is null or actual_staff_count >= 0),
  constraint event_setup_raw_completed_after_arrival check (
    completed_recorded_at is null
    or (arrival_recorded_at is not null and completed_recorded_at >= arrival_recorded_at)
  ),
  constraint event_setup_adjusted_order check (
    adjusted_arrival_at is null
    or adjusted_completed_at is null
    or adjusted_completed_at >= adjusted_arrival_at
  )
);

comment on table public.event_setup_sessions is 'One setup work session per row. event_id is not PK so a venue can be reset later.';
comment on column public.event_setup_sessions.arrival_recorded_at is 'Raw server timestamp. Immutable once set.';
comment on column public.event_setup_sessions.completed_recorded_at is 'Raw server timestamp. Immutable once set.';
comment on column public.event_setup_sessions.adjusted_arrival_at is 'ADMIN correction. Does not overwrite raw.';

create index event_setup_sessions_event_idx on public.event_setup_sessions (event_id, created_at desc);

create trigger event_setup_sessions_set_updated_at
before update on public.event_setup_sessions
for each row execute procedure private.set_updated_at();

create or replace function private.protect_setup_raw_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.arrival_recorded_at is not null and new.arrival_recorded_at is distinct from old.arrival_recorded_at then
    raise exception 'raw_timestamp_immutable';
  end if;
  if old.completed_recorded_at is not null and new.completed_recorded_at is distinct from old.completed_recorded_at then
    raise exception 'raw_timestamp_immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_setup_raw_timestamps() from public;
revoke execute on function private.protect_setup_raw_timestamps() from anon, authenticated;

create trigger event_setup_sessions_protect_raw
before update on public.event_setup_sessions
for each row execute procedure private.protect_setup_raw_timestamps();

create table public.event_setup_fixtures (
  id uuid primary key default gen_random_uuid(),
  setup_session_id uuid not null references public.event_setup_sessions (id) on delete restrict,
  fixture_type public.setup_fixture_type not null,
  name_snapshot text not null,
  preparation_item_id uuid references public.preparation_items (id) on delete set null,
  width_mm integer,
  depth_mm integer,
  height_mm integer,
  frontage_mm_per_unit integer,
  planned_quantity integer not null,
  actual_quantity integer,
  rack_levels integer,
  layout_note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint event_setup_fixtures_name_not_blank check (char_length(btrim(name_snapshot)) > 0),
  constraint event_setup_fixtures_planned_nonneg check (planned_quantity >= 0),
  constraint event_setup_fixtures_actual_nonneg check (actual_quantity is null or actual_quantity >= 0),
  constraint event_setup_fixtures_width_pos check (width_mm is null or width_mm > 0),
  constraint event_setup_fixtures_depth_pos check (depth_mm is null or depth_mm > 0),
  constraint event_setup_fixtures_height_pos check (height_mm is null or height_mm > 0),
  constraint event_setup_fixtures_frontage_pos check (frontage_mm_per_unit is null or frontage_mm_per_unit > 0),
  constraint event_setup_fixtures_rack_levels_pos check (rack_levels is null or rack_levels > 0)
);

comment on table public.event_setup_fixtures is 'Per-event physical install snapshot. Preparation master size changes do not rewrite these rows.';
comment on column public.event_setup_fixtures.frontage_mm_per_unit is 'Optional selling-face mm. NULL uses width_mm.';
comment on column public.event_setup_fixtures.width_mm is 'Integer millimeters. UI may show meters.';

create index event_setup_fixtures_session_idx on public.event_setup_fixtures (setup_session_id, sort_order);

create trigger event_setup_fixtures_set_updated_at
before update on public.event_setup_fixtures
for each row execute procedure private.set_updated_at();

create table public.event_setup_members (
  id uuid primary key default gen_random_uuid(),
  setup_session_id uuid not null references public.event_setup_sessions (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  role public.setup_member_role not null default 'MEMBER',
  created_at timestamptz not null default pg_catalog.now(),
  constraint event_setup_members_unique unique (setup_session_id, profile_id)
);

comment on table public.event_setup_members is 'Setup crew assignment. Not attendance or payroll.';

create index event_setup_members_session_idx on public.event_setup_members (setup_session_id);
create index event_setup_members_profile_idx on public.event_setup_members (profile_id);

create table public.event_setup_photos (
  id uuid primary key default gen_random_uuid(),
  setup_session_id uuid not null references public.event_setup_sessions (id) on delete restrict,
  photo_type public.setup_photo_type not null,
  storage_path text not null,
  captured_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null,
  note text,
  created_at timestamptz not null default pg_catalog.now(),
  constraint event_setup_photos_path_not_blank check (char_length(btrim(storage_path)) > 0)
);

comment on table public.event_setup_photos is 'Setup evidence. Bytes in setup-photos. recorded_at is server time.';

create unique index event_setup_photos_storage_path_uidx on public.event_setup_photos (storage_path);
create index event_setup_photos_session_idx on public.event_setup_photos (setup_session_id, recorded_at);

create or replace function private.protect_setup_photos_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'setup_photo_immutable';
end;
$$;

revoke all on function private.protect_setup_photos_immutable() from public;
revoke execute on function private.protect_setup_photos_immutable() from anon, authenticated;

create trigger event_setup_photos_immutable
before update on public.event_setup_photos
for each row execute procedure private.protect_setup_photos_immutable();

create table public.operation_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location_type public.operation_location_type not null,
  address text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  is_active boolean not null default true,
  memo text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint operation_locations_name_not_blank check (char_length(btrim(name)) > 0)
);

comment on table public.operation_locations is 'Repeat crew/gear hubs. Not inventory_locations and not event venues.';

create unique index operation_locations_name_uidx on public.operation_locations (name);

create trigger operation_locations_set_updated_at
before update on public.operation_locations
for each row execute procedure private.set_updated_at();

create table public.event_transition_legs (
  id uuid primary key default gen_random_uuid(),
  from_event_id uuid references public.events (id) on delete restrict,
  from_operation_location_id uuid references public.operation_locations (id) on delete restrict,
  to_event_id uuid references public.events (id) on delete restrict,
  to_operation_location_id uuid references public.operation_locations (id) on delete restrict,
  movement_subject public.transition_movement_subject not null,
  planned_departure_at timestamptz,
  planned_arrival_at timestamptz,
  planned_travel_minutes integer,
  planned_buffer_minutes integer,
  actual_departure_at timestamptz,
  actual_arrival_at timestamptz,
  staff_count integer,
  vehicle_note text,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint event_transition_from_xor check (
    (from_event_id is not null)::int + (from_operation_location_id is not null)::int = 1
  ),
  constraint event_transition_to_xor check (
    (to_event_id is not null)::int + (to_operation_location_id is not null)::int = 1
  ),
  constraint event_transition_not_same_event check (
    from_event_id is null or to_event_id is null or from_event_id <> to_event_id
  ),
  constraint event_transition_not_same_location check (
    from_operation_location_id is null
    or to_operation_location_id is null
    or from_operation_location_id <> to_operation_location_id
  ),
  constraint event_transition_planned_order check (
    planned_departure_at is null or planned_arrival_at is null or planned_arrival_at >= planned_departure_at
  ),
  constraint event_transition_actual_order check (
    actual_departure_at is null or actual_arrival_at is null or actual_arrival_at >= actual_departure_at
  ),
  constraint event_transition_minutes_nonneg check (
    (planned_travel_minutes is null or planned_travel_minutes >= 0)
    and (planned_buffer_minutes is null or planned_buffer_minutes >= 0)
  ),
  constraint event_transition_staff_nonneg check (staff_count is null or staff_count >= 0)
);

comment on table public.event_transition_legs is 'Crew/gear travel between events and operation hubs. Not inventory movements. No map API.';

create index event_transition_from_event_idx on public.event_transition_legs (from_event_id);
create index event_transition_to_event_idx on public.event_transition_legs (to_event_id);
create index event_transition_from_loc_idx on public.event_transition_legs (from_operation_location_id);
create index event_transition_to_loc_idx on public.event_transition_legs (to_operation_location_id);

create trigger event_transition_legs_set_updated_at
before update on public.event_transition_legs
for each row execute procedure private.set_updated_at();

create or replace function private.can_read_setup_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_setup_sessions as s
    where s.id = p_session_id
      and private.can_read_event(s.event_id)
  );
$$;

create or replace function private.can_read_transition_leg(p_leg_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_transition_legs as t
    where t.id = p_leg_id
      and (
        private.is_admin_user()
        or (t.from_event_id is not null and private.can_read_event(t.from_event_id))
        or (t.to_event_id is not null and private.can_read_event(t.to_event_id))
      )
  );
$$;

revoke all on function private.can_read_setup_session(uuid) from public;
revoke all on function private.can_read_transition_leg(uuid) from public;
revoke execute on function private.can_read_setup_session(uuid) from anon;
revoke execute on function private.can_read_transition_leg(uuid) from anon;
grant execute on function private.can_read_setup_session(uuid) to authenticated;
grant execute on function private.can_read_transition_leg(uuid) to authenticated;

alter table public.event_setup_sessions enable row level security;
alter table public.event_setup_sessions force row level security;
alter table public.event_setup_fixtures enable row level security;
alter table public.event_setup_fixtures force row level security;
alter table public.event_setup_members enable row level security;
alter table public.event_setup_members force row level security;
alter table public.event_setup_photos enable row level security;
alter table public.event_setup_photos force row level security;
alter table public.operation_locations enable row level security;
alter table public.operation_locations force row level security;
alter table public.event_transition_legs enable row level security;
alter table public.event_transition_legs force row level security;

revoke all on table public.event_setup_sessions from anon, authenticated, public;
revoke all on table public.event_setup_fixtures from anon, authenticated, public;
revoke all on table public.event_setup_members from anon, authenticated, public;
revoke all on table public.event_setup_photos from anon, authenticated, public;
revoke all on table public.operation_locations from anon, authenticated, public;
revoke all on table public.event_transition_legs from anon, authenticated, public;

grant select on table public.event_setup_sessions to authenticated;
grant select on table public.event_setup_fixtures to authenticated;
grant select on table public.event_setup_members to authenticated;
grant select on table public.event_setup_photos to authenticated;
grant select on table public.operation_locations to authenticated;
grant select on table public.event_transition_legs to authenticated;

create policy event_setup_sessions_select
on public.event_setup_sessions for select to authenticated
using (private.can_read_event(event_id));

create policy event_setup_fixtures_select
on public.event_setup_fixtures for select to authenticated
using (private.can_read_setup_session(setup_session_id));

create policy event_setup_members_select
on public.event_setup_members for select to authenticated
using (private.can_read_setup_session(setup_session_id));

create policy event_setup_photos_select
on public.event_setup_photos for select to authenticated
using (private.can_read_setup_session(setup_session_id));

create policy operation_locations_select
on public.operation_locations for select to authenticated
using (private.has_app_access());

create policy event_transition_legs_select
on public.event_transition_legs for select to authenticated
using (
  private.is_admin_user()
  or (from_event_id is not null and private.can_read_event(from_event_id))
  or (to_event_id is not null and private.can_read_event(to_event_id))
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'setup-photos',
  'setup-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
);

create policy setup_photos_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'setup-photos'
  and private.can_read_event(private.storage_event_id(name))
);

create policy setup_photos_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'setup-photos'
  and private.can_read_event(private.storage_event_id(name))
);
