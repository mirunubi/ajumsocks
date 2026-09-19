-- Phase 2 event management: events, members, contacts, photos, storage, RLS.
-- Do not edit earlier migrations.

create type public.event_status as enum (
  'PREPARING',
  'ACTIVE',
  'ENDED',
  'SETTLED',
  'CANCELLED'
);

create type public.event_contract_type as enum (
  'NONE',
  'COMMISSION',
  'FIXED_FEE',
  'MIXED'
);

create type public.event_assignment_role as enum (
  'MANAGER',
  'STAFF',
  'PART_TIMER'
);

create type public.event_contact_type as enum (
  'VENUE',
  'HQ',
  'OTHER'
);

grant usage on type public.event_status to authenticated, anon;
grant usage on type public.event_contract_type to authenticated, anon;
grant usage on type public.event_assignment_role to authenticated, anon;
grant usage on type public.event_contact_type to authenticated, anon;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.event_status not null default 'PREPARING',
  venue_name text not null,
  address text not null,
  address_detail text,
  memo text,
  contract_type public.event_contract_type not null default 'NONE',
  commission_rate numeric(5, 2),
  fixed_fee numeric(12, 0),
  contract_memo text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint events_name_not_blank check (char_length(btrim(name)) > 0),
  constraint events_venue_not_blank check (char_length(btrim(venue_name)) > 0),
  constraint events_address_not_blank check (char_length(btrim(address)) > 0),
  constraint events_ends_after_starts check (ends_at >= starts_at),
  constraint events_commission_rate_range check (
    commission_rate is null or (commission_rate >= 0 and commission_rate <= 100)
  ),
  constraint events_fixed_fee_non_negative check (fixed_fee is null or fixed_fee >= 0),
  constraint events_contract_values check (
    (contract_type = 'NONE')
    or (contract_type = 'COMMISSION' and commission_rate is not null)
    or (contract_type = 'FIXED_FEE' and fixed_fee is not null)
    or (
      contract_type = 'MIXED'
      and commission_rate is not null
      and fixed_fee is not null
    )
  )
);

comment on table public.events is 'External sales events. Contract fields are stored here; P&L is a later phase.';
comment on column public.events.status is 'Operational status. Dates do not auto-change this value.';
comment on column public.events.commission_rate is 'Percent 0-100. Used when COMMISSION or MIXED.';
comment on column public.events.fixed_fee is 'KRW. Used when FIXED_FEE or MIXED.';

create index events_starts_at_idx on public.events (starts_at desc);
create index events_status_idx on public.events (status);

create trigger events_set_updated_at
before update on public.events
for each row
execute procedure private.set_updated_at();

create table public.event_members (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  assignment_role public.event_assignment_role not null,
  created_at timestamptz not null default pg_catalog.now(),
  created_by uuid references public.profiles (id),
  constraint event_members_unique unique (event_id, profile_id)
);

comment on table public.event_members is 'N:M assignment. assignment_role is independent from profiles.role. Rows are kept as history.';

create index event_members_event_id_idx on public.event_members (event_id);
create index event_members_profile_id_idx on public.event_members (profile_id);

create table public.event_contacts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  contact_type public.event_contact_type not null,
  name text not null,
  company text,
  department text,
  position text,
  phone text,
  memo text,
  sort_order integer not null default 0,
  constraint event_contacts_name_not_blank check (char_length(btrim(name)) > 0)
);

comment on table public.event_contacts is 'External venue/HQ contacts. Not app users.';

create index event_contacts_event_sort_idx on public.event_contacts (event_id, sort_order);

create table public.event_photos (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  file_size bigint not null,
  caption text,
  photo_type text not null default 'other',
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default pg_catalog.now(),
  constraint event_photos_path_not_blank check (char_length(btrim(storage_path)) > 0),
  constraint event_photos_size_positive check (file_size > 0)
);

comment on table public.event_photos is 'Photo metadata only. Binary files live in Storage bucket event-photos.';

create unique index event_photos_storage_path_uidx on public.event_photos (storage_path);
create index event_photos_event_id_idx on public.event_photos (event_id);

create or replace function private.can_read_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.has_app_access(), false)
     and (
       coalesce(private.is_admin_user(), false)
       or exists (
         select 1
         from public.event_members as m
         where m.event_id = p_event_id
           and m.profile_id = auth.uid()
       )
     );
$$;

create or replace function private.can_write_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_admin_user(), false);
$$;

create or replace function private.storage_event_id(object_name text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  folder text;
begin
  folder := (storage.foldername(object_name))[1];
  if folder is null or folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return folder::uuid;
end;
$$;

revoke all on function private.can_read_event(uuid) from public;
revoke all on function private.can_write_event(uuid) from public;
revoke all on function private.storage_event_id(text) from public;
revoke execute on function private.can_read_event(uuid) from anon;
revoke execute on function private.can_write_event(uuid) from anon;
revoke execute on function private.storage_event_id(text) from anon;
grant execute on function private.can_read_event(uuid) to authenticated;
grant execute on function private.can_write_event(uuid) to authenticated;
grant execute on function private.storage_event_id(text) to authenticated;

alter table public.events enable row level security;
alter table public.events force row level security;
alter table public.event_members enable row level security;
alter table public.event_members force row level security;
alter table public.event_contacts enable row level security;
alter table public.event_contacts force row level security;
alter table public.event_photos enable row level security;
alter table public.event_photos force row level security;

revoke all on table public.events from anon, authenticated, public;
revoke all on table public.event_members from anon, authenticated, public;
revoke all on table public.event_contacts from anon, authenticated, public;
revoke all on table public.event_photos from anon, authenticated, public;

grant select on table public.events to authenticated;
grant select on table public.event_members to authenticated;
grant select on table public.event_contacts to authenticated;
grant select on table public.event_photos to authenticated;

create policy events_select_assigned
on public.events
for select
to authenticated
using (private.can_read_event(id));

create policy event_members_select_assigned
on public.event_members
for select
to authenticated
using (private.can_read_event(event_id));

create policy event_contacts_select_assigned
on public.event_contacts
for select
to authenticated
using (private.can_read_event(event_id));

create policy event_photos_select_assigned
on public.event_photos
for select
to authenticated
using (private.can_read_event(event_id));

-- Assigned staff may see colleague names/phones on the same event.
create policy profiles_select_event_colleague
on public.profiles
for select
to authenticated
using (
  private.has_app_access()
  and exists (
    select 1
    from public.event_members as mine
    join public.event_members as other
      on other.event_id = mine.event_id
    where mine.profile_id = auth.uid()
      and other.profile_id = profiles.id
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-photos',
  'event-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
);

create policy event_photos_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'event-photos'
  and private.can_read_event(private.storage_event_id(name))
);

create policy event_photos_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'event-photos'
  and private.can_read_event(private.storage_event_id(name))
);

create policy event_photos_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'event-photos'
  and private.can_write_event(private.storage_event_id(name))
);
