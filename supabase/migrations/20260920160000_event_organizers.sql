-- Event organizers (hosts / venue operators). Not product suppliers.
-- Do not edit earlier migrations.

create table public.event_organizers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  calendar_color text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint event_organizers_name_not_blank check (char_length(btrim(name)) > 0),
  constraint event_organizers_color_hex check (calendar_color ~ '^#[0-9A-Fa-f]{6}$')
);

comment on table public.event_organizers is
  'Event host / venue operator. Safe fields only (name, color). Not a product supplier.';

create unique index event_organizers_name_lower_uidx
  on public.event_organizers (lower(btrim(name)));

create trigger event_organizers_set_updated_at
before update on public.event_organizers
for each row
execute procedure private.set_updated_at();

create table public.event_organizer_terms (
  organizer_id uuid primary key references public.event_organizers (id) on delete restrict,
  default_contract_type public.event_contract_type not null default 'NONE',
  default_commission_rate numeric(5, 2),
  default_fixed_fee numeric(12, 0),
  memo text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint event_organizer_terms_rate_range check (
    default_commission_rate is null
    or (default_commission_rate >= 0 and default_commission_rate <= 100)
  ),
  constraint event_organizer_terms_fee_nonneg check (
    default_fixed_fee is null or default_fixed_fee >= 0
  ),
  constraint event_organizer_terms_values check (
    (default_contract_type = 'NONE')
    or (default_contract_type = 'COMMISSION' and default_commission_rate is not null)
    or (default_contract_type = 'FIXED_FEE' and default_fixed_fee is not null)
    or (
      default_contract_type = 'MIXED'
      and default_commission_rate is not null
      and default_fixed_fee is not null
    )
  )
);

comment on table public.event_organizer_terms is
  'ADMIN-only default contract for new events. Copied onto events at create; later edits do not rewrite existing events.';

create trigger event_organizer_terms_set_updated_at
before update on public.event_organizer_terms
for each row
execute procedure private.set_updated_at();

create table public.event_organizer_contacts (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.event_organizers (id) on delete restrict,
  contact_type public.event_contact_type not null,
  name text not null,
  department text,
  position text,
  phone text,
  email text,
  memo text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint event_organizer_contacts_name_not_blank check (char_length(btrim(name)) > 0)
);

comment on table public.event_organizer_contacts is
  'Current organizer contact master. Copied to event_contacts at event create; later edits do not rewrite event snapshots.';

create index event_organizer_contacts_org_sort_idx
  on public.event_organizer_contacts (organizer_id, sort_order);

create trigger event_organizer_contacts_set_updated_at
before update on public.event_organizer_contacts
for each row
execute procedure private.set_updated_at();

alter table public.events
  add column organizer_id uuid references public.event_organizers (id) on delete restrict;

comment on column public.events.organizer_id is
  'Nullable for events created before organizers existed. New UI requires a selection.';

create index events_organizer_id_idx on public.events (organizer_id);

alter table public.event_contacts
  add column email text;

grant select (organizer_id) on table public.events to authenticated;

alter table public.event_organizers enable row level security;
alter table public.event_organizers force row level security;
alter table public.event_organizer_terms enable row level security;
alter table public.event_organizer_terms force row level security;
alter table public.event_organizer_contacts enable row level security;
alter table public.event_organizer_contacts force row level security;

revoke all on table public.event_organizers from anon, authenticated, public;
revoke all on table public.event_organizer_terms from anon, authenticated, public;
revoke all on table public.event_organizer_contacts from anon, authenticated, public;

grant select on table public.event_organizers to authenticated;
grant select on table public.event_organizer_terms to authenticated;
grant select on table public.event_organizer_contacts to authenticated;

create policy event_organizers_select_access
on public.event_organizers
for select
to authenticated
using (private.has_app_access());

create policy event_organizer_terms_select_admin
on public.event_organizer_terms
for select
to authenticated
using (private.is_admin_user());

create policy event_organizer_contacts_select_admin
on public.event_organizer_contacts
for select
to authenticated
using (private.is_admin_user());
