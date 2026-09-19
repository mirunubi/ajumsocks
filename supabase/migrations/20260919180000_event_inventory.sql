-- Phase 6 event inventory checks. Approximate on-site counts only.
-- No locations, movements, shipments, or purchase orders.

create table public.event_inventory_checks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  check_kind text not null,
  check_scope text not null,
  status text not null default 'DRAFT',
  started_at timestamptz not null default now(),
  started_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete set null,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_inventory_checks_kind_allowed check (check_kind in ('OPENING', 'ROUTINE', 'CLOSING')),
  constraint event_inventory_checks_scope_allowed check (check_scope in ('FULL', 'PARTIAL')),
  constraint event_inventory_checks_status_allowed check (status in ('DRAFT', 'CONFIRMED', 'CANCELLED'))
);

comment on table public.event_inventory_checks is 'On-site approximate stock check session. Not an inventory movement.';

create index event_inventory_checks_event_status_idx
  on public.event_inventory_checks (event_id, status, started_at desc);

create trigger event_inventory_checks_set_updated_at
before update on public.event_inventory_checks
for each row execute procedure private.set_updated_at();

create table public.event_inventory_check_items (
  id uuid primary key default gen_random_uuid(),
  inventory_check_id uuid not null references public.event_inventory_checks (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete restrict,
  event_assortment_item_id uuid not null references public.event_assortment_items (id) on delete restrict,
  product_variant_id uuid not null references public.product_variants (id) on delete restrict,
  pack_size_snapshot integer not null,
  full_pack_count integer,
  remainder_level text,
  checked_at timestamptz,
  checked_by uuid references public.profiles (id) on delete set null,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_inventory_check_items_pack_positive check (pack_size_snapshot > 0),
  constraint event_inventory_check_items_packs_nonneg check (full_pack_count is null or full_pack_count >= 0),
  constraint event_inventory_check_items_remainder_allowed check (
    remainder_level is null
    or remainder_level in ('ZERO', 'VERY_LOW', 'HALF', 'HIGH', 'FULL')
  ),
  constraint event_inventory_check_items_pair check (
    (full_pack_count is null and remainder_level is null)
    or (full_pack_count is not null and remainder_level is not null)
  ),
  constraint event_inventory_check_items_sku_uidx unique (inventory_check_id, product_variant_id)
);

comment on table public.event_inventory_check_items is 'NULL pair = not checked. ZERO remainder = confirmed empty. Estimate is computed, not stored.';

create index event_inventory_check_items_check_idx
  on public.event_inventory_check_items (inventory_check_id);

create trigger event_inventory_check_items_set_updated_at
before update on public.event_inventory_check_items
for each row execute procedure private.set_updated_at();

create table public.event_inventory_current (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  event_assortment_item_id uuid not null references public.event_assortment_items (id) on delete restrict,
  product_variant_id uuid not null references public.product_variants (id) on delete restrict,
  pack_size_snapshot integer not null,
  full_pack_count integer not null,
  remainder_level text not null,
  source_check_id uuid not null references public.event_inventory_checks (id) on delete restrict,
  first_recognized_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint event_inventory_current_pack_positive check (pack_size_snapshot > 0),
  constraint event_inventory_current_packs_nonneg check (full_pack_count >= 0),
  constraint event_inventory_current_remainder_allowed check (
    remainder_level in ('ZERO', 'VERY_LOW', 'HALF', 'HIGH', 'FULL')
  ),
  constraint event_inventory_current_event_sku_uidx unique (event_id, product_variant_id)
);

comment on table public.event_inventory_current is 'Latest CONFIRMED approximate on-site stock. First confirm is the baseline, not a shipment backfill.';

create index event_inventory_current_event_idx
  on public.event_inventory_current (event_id);

create index event_inventory_current_variant_idx
  on public.event_inventory_current (product_variant_id);

create trigger event_inventory_current_set_updated_at
before update on public.event_inventory_current
for each row execute procedure private.set_updated_at();

create or replace function public.start_event_inventory_check(
  p_event_id uuid,
  p_check_kind text,
  p_check_scope text,
  p_started_by uuid,
  p_memo text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check_id uuid;
  v_count integer;
begin
  if p_check_kind not in ('OPENING', 'ROUTINE', 'CLOSING') then
    raise exception 'invalid_kind';
  end if;
  if p_check_scope not in ('FULL', 'PARTIAL') then
    raise exception 'invalid_scope';
  end if;

  insert into public.event_inventory_checks (
    event_id, check_kind, check_scope, status, started_by, memo
  ) values (
    p_event_id, p_check_kind, p_check_scope, 'DRAFT', p_started_by, p_memo
  ) returning id into v_check_id;

  insert into public.event_inventory_check_items (
    inventory_check_id,
    event_id,
    event_assortment_item_id,
    product_variant_id,
    pack_size_snapshot
  )
  select
    v_check_id,
    p_event_id,
    i.id,
    i.product_variant_id,
    coalesce(nullif(p.default_pack_quantity, 0), 10)
  from public.event_assortment_items as i
  join public.products as p on p.id = i.product_id
  where i.event_id = p_event_id
    and i.removed_at is null;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'empty_targets';
  end if;

  return v_check_id;
end;
$$;

create or replace function public.confirm_event_inventory_check(
  p_check_id uuid,
  p_confirmed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check public.event_inventory_checks;
  v_missing integer;
  v_filled integer;
begin
  select * into v_check
  from public.event_inventory_checks
  where id = p_check_id
  for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_check.status = 'CONFIRMED' then
    raise exception 'already_confirmed';
  end if;
  if v_check.status is distinct from 'DRAFT' then
    raise exception 'not_draft';
  end if;

  if v_check.check_scope = 'FULL' then
    select count(*) into v_missing
    from public.event_inventory_check_items as i
    where i.inventory_check_id = p_check_id
      and (i.full_pack_count is null or i.remainder_level is null);
    if v_missing > 0 then
      raise exception 'incomplete_full_check';
    end if;
  else
    select count(*) into v_filled
    from public.event_inventory_check_items as i
    where i.inventory_check_id = p_check_id
      and i.full_pack_count is not null
      and i.remainder_level is not null;
    if v_filled = 0 then
      raise exception 'empty_partial_check';
    end if;
  end if;

  insert into public.event_inventory_current (
    event_id,
    event_assortment_item_id,
    product_variant_id,
    pack_size_snapshot,
    full_pack_count,
    remainder_level,
    source_check_id,
    first_recognized_at,
    updated_by
  )
  select
    i.event_id,
    i.event_assortment_item_id,
    i.product_variant_id,
    i.pack_size_snapshot,
    i.full_pack_count,
    i.remainder_level,
    p_check_id,
    now(),
    p_confirmed_by
  from public.event_inventory_check_items as i
  where i.inventory_check_id = p_check_id
    and i.full_pack_count is not null
    and i.remainder_level is not null
  on conflict (event_id, product_variant_id) do update
  set
    event_assortment_item_id = excluded.event_assortment_item_id,
    pack_size_snapshot = excluded.pack_size_snapshot,
    full_pack_count = excluded.full_pack_count,
    remainder_level = excluded.remainder_level,
    source_check_id = excluded.source_check_id,
    updated_by = excluded.updated_by,
    updated_at = now();

  update public.event_inventory_checks
  set
    status = 'CONFIRMED',
    confirmed_at = now(),
    confirmed_by = p_confirmed_by
  where id = p_check_id;

  return jsonb_build_object('id', p_check_id, 'status', 'CONFIRMED');
end;
$$;

revoke all on function public.start_event_inventory_check(uuid, text, text, uuid, text) from public;
revoke all on function public.confirm_event_inventory_check(uuid, uuid) from public;
revoke execute on function public.start_event_inventory_check(uuid, text, text, uuid, text) from anon, authenticated;
revoke execute on function public.confirm_event_inventory_check(uuid, uuid) from anon, authenticated;
grant execute on function public.start_event_inventory_check(uuid, text, text, uuid, text) to service_role;
grant execute on function public.confirm_event_inventory_check(uuid, uuid) to service_role;

create or replace function private.guard_confirmed_inventory_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'CONFIRMED' then
      raise exception 'confirmed_immutable';
    end if;
    return old;
  end if;
  if old.status = 'CONFIRMED' then
    raise exception 'confirmed_immutable';
  end if;
  return new;
end;
$$;

create trigger event_inventory_checks_guard_confirmed
before update or delete on public.event_inventory_checks
for each row execute procedure private.guard_confirmed_inventory_check();

create or replace function private.guard_confirmed_inventory_check_items()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.event_inventory_checks
  where id = coalesce(new.inventory_check_id, old.inventory_check_id);
  if v_status = 'CONFIRMED' then
    raise exception 'confirmed_immutable';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger event_inventory_check_items_guard_confirmed
before insert or update or delete on public.event_inventory_check_items
for each row execute procedure private.guard_confirmed_inventory_check_items();

alter table public.event_inventory_checks enable row level security;
alter table public.event_inventory_checks force row level security;
alter table public.event_inventory_check_items enable row level security;
alter table public.event_inventory_check_items force row level security;
alter table public.event_inventory_current enable row level security;
alter table public.event_inventory_current force row level security;

revoke all on table public.event_inventory_checks from anon, authenticated, public;
revoke all on table public.event_inventory_check_items from anon, authenticated, public;
revoke all on table public.event_inventory_current from anon, authenticated, public;

grant select on table public.event_inventory_checks to authenticated;
grant select on table public.event_inventory_check_items to authenticated;
grant select on table public.event_inventory_current to authenticated;

create policy event_inventory_checks_select_assigned
on public.event_inventory_checks for select to authenticated
using (private.can_read_event(event_id));

create policy event_inventory_check_items_select_assigned
on public.event_inventory_check_items for select to authenticated
using (private.can_read_event(event_id));

create policy event_inventory_current_select_assigned
on public.event_inventory_current for select to authenticated
using (private.can_read_event(event_id));
