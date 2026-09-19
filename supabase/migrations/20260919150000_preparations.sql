-- Phase 3 preparation templates and event snapshots.
-- Do not edit earlier migrations.

create type public.preparation_item_type as enum ('EQUIPMENT', 'CONSUMABLE');
create type public.preparation_status as enum ('NOT_READY', 'READY', 'ON_SITE', 'RETURNED');

grant usage on type public.preparation_item_type to authenticated, anon;
grant usage on type public.preparation_status to authenticated, anon;

create table public.preparation_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  item_type public.preparation_item_type not null,
  default_unit text not null default '개',
  requires_return boolean not null,
  memo text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint preparation_items_name_not_blank check (char_length(btrim(name)) > 0),
  constraint preparation_items_unit_not_blank check (char_length(btrim(default_unit)) > 0)
);

comment on table public.preparation_items is 'Equipment/consumable master. Not sellable product SKUs.';

create index preparation_items_active_sort_idx
  on public.preparation_items (is_active, sort_order, name);

create trigger preparation_items_set_updated_at
before update on public.preparation_items
for each row
execute procedure private.set_updated_at();

create table public.preparation_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint preparation_sets_name_not_blank check (char_length(btrim(name)) > 0)
);

comment on table public.preparation_sets is 'Reusable preparation templates. Applying a set copies rows into event snapshots.';

create trigger preparation_sets_set_updated_at
before update on public.preparation_sets
for each row
execute procedure private.set_updated_at();

create table public.preparation_set_items (
  id uuid primary key default gen_random_uuid(),
  preparation_set_id uuid not null references public.preparation_sets (id) on delete cascade,
  preparation_item_id uuid not null references public.preparation_items (id) on delete restrict,
  planned_quantity numeric(12, 2) not null,
  sort_order integer not null default 0,
  memo text,
  constraint preparation_set_items_qty_positive check (planned_quantity >= 1),
  constraint preparation_set_items_unique unique (preparation_set_id, preparation_item_id)
);

create index preparation_set_items_set_idx
  on public.preparation_set_items (preparation_set_id, sort_order);

create table public.event_preparation_plans (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  source_preparation_set_id uuid references public.preparation_sets (id) on delete restrict,
  applied_by uuid references public.profiles (id),
  applied_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint event_preparation_plans_event_uidx unique (event_id)
);

comment on table public.event_preparation_plans is 'One preparation plan per event. Re-apply is rejected to avoid overwrite.';

create trigger event_preparation_plans_set_updated_at
before update on public.event_preparation_plans
for each row
execute procedure private.set_updated_at();

create table public.event_preparation_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.event_preparation_plans (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete restrict,
  source_preparation_item_id uuid references public.preparation_items (id) on delete restrict,
  item_name_snapshot text not null,
  item_type_snapshot public.preparation_item_type not null,
  unit_snapshot text not null,
  planned_quantity numeric(12, 2) not null,
  requires_return boolean not null,
  status public.preparation_status not null default 'NOT_READY',
  memo text,
  sort_order integer not null default 0,
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  removed_at timestamptz,
  constraint event_preparation_items_qty_positive check (planned_quantity >= 1),
  constraint event_preparation_items_name_not_blank check (char_length(btrim(item_name_snapshot)) > 0),
  constraint event_preparation_items_consumable_no_return check (
    requires_return or status <> 'RETURNED'
  )
);

comment on table public.event_preparation_items is 'Per-event snapshot. UI must display snapshot columns, not live master values.';

create index event_preparation_items_event_status_idx
  on public.event_preparation_items (event_id, status)
  where removed_at is null;

create unique index event_preparation_items_active_source_uidx
  on public.event_preparation_items (event_id, source_preparation_item_id)
  where removed_at is null and source_preparation_item_id is not null;

create trigger event_preparation_items_set_updated_at
before update on public.event_preparation_items
for each row
execute procedure private.set_updated_at();

alter table public.preparation_items enable row level security;
alter table public.preparation_items force row level security;
alter table public.preparation_sets enable row level security;
alter table public.preparation_sets force row level security;
alter table public.preparation_set_items enable row level security;
alter table public.preparation_set_items force row level security;
alter table public.event_preparation_plans enable row level security;
alter table public.event_preparation_plans force row level security;
alter table public.event_preparation_items enable row level security;
alter table public.event_preparation_items force row level security;

revoke all on table public.preparation_items from anon, authenticated, public;
revoke all on table public.preparation_sets from anon, authenticated, public;
revoke all on table public.preparation_set_items from anon, authenticated, public;
revoke all on table public.event_preparation_plans from anon, authenticated, public;
revoke all on table public.event_preparation_items from anon, authenticated, public;

grant select on table public.preparation_items to authenticated;
grant select on table public.preparation_sets to authenticated;
grant select on table public.preparation_set_items to authenticated;
grant select on table public.event_preparation_plans to authenticated;
grant select on table public.event_preparation_items to authenticated;

create policy preparation_items_select_admin
on public.preparation_items
for select
to authenticated
using (private.is_admin_user());

create policy preparation_sets_select_admin
on public.preparation_sets
for select
to authenticated
using (private.is_admin_user());

create policy preparation_set_items_select_admin
on public.preparation_set_items
for select
to authenticated
using (private.is_admin_user());

create policy event_preparation_plans_select_assigned
on public.event_preparation_plans
for select
to authenticated
using (private.can_read_event(event_id));

create policy event_preparation_items_select_assigned
on public.event_preparation_items
for select
to authenticated
using (private.can_read_event(event_id));
