-- Phase 7 inventory locations, positions, movements, adjustments.
-- No purchase orders, carriers, invoices, or sales.

create or replace function private.remainder_midpoint(p_level text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_level
    when 'ZERO' then 0
    when 'VERY_LOW' then 2
    when 'HALF' then 5
    when 'HIGH' then 8
    when 'FULL' then 10
    else null
  end;
$$;

create table public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  location_type text not null,
  name text not null,
  event_id uuid references public.events (id) on delete restrict,
  address text,
  address_detail text,
  contact_name text,
  contact_phone text,
  is_active boolean not null default true,
  memo text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_locations_type_allowed check (location_type in ('HQ', 'EVENT', 'TEMP', 'THIRD_PARTY')),
  constraint inventory_locations_name_not_blank check (length(trim(name)) > 0),
  constraint inventory_locations_event_pair check (
    (location_type = 'EVENT' and event_id is not null)
    or (location_type <> 'EVENT' and event_id is null)
  )
);

comment on table public.inventory_locations is 'Stock place. EVENT is 1:1 with events. Not a carrier or warehouse network.';

create unique index inventory_locations_one_hq_uidx
  on public.inventory_locations (location_type)
  where location_type = 'HQ';

create unique index inventory_locations_one_event_uidx
  on public.inventory_locations (event_id)
  where location_type = 'EVENT' and event_id is not null;

create index inventory_locations_type_idx
  on public.inventory_locations (location_type, is_active);

create trigger inventory_locations_set_updated_at
before update on public.inventory_locations
for each row execute procedure private.set_updated_at();

create or replace function private.ensure_event_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.inventory_locations (
      location_type, name, event_id, address, address_detail, created_by
    ) values (
      'EVENT', new.name, new.id, new.address, new.address_detail, new.created_by
    );
  elsif tg_op = 'UPDATE' then
    update public.inventory_locations
    set
      name = new.name,
      address = new.address,
      address_detail = new.address_detail
    where event_id = new.id
      and location_type = 'EVENT';
  end if;
  return new;
end;
$$;

create trigger events_ensure_inventory_location
after insert or update of name, address, address_detail on public.events
for each row execute procedure private.ensure_event_location();

insert into public.inventory_locations (location_type, name, event_id, address, address_detail, created_by)
select 'EVENT', e.name, e.id, e.address, e.address_detail, e.created_by
from public.events as e
where not exists (
  select 1 from public.inventory_locations as l
  where l.event_id = e.id and l.location_type = 'EVENT'
);

create table public.inventory_positions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.inventory_locations (id) on delete restrict,
  product_variant_id uuid not null references public.product_variants (id) on delete restrict,
  estimated_units integer not null,
  last_physical_check_id uuid references public.event_inventory_checks (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint inventory_positions_units_nonneg check (estimated_units >= 0),
  constraint inventory_positions_location_sku_uidx unique (location_id, product_variant_id)
);

comment on table public.inventory_positions is 'Operational approximate stock projection. History lives in checks, movements, adjustments.';

create index inventory_positions_location_idx
  on public.inventory_positions (location_id);

create index inventory_positions_variant_idx
  on public.inventory_positions (product_variant_id);

create trigger inventory_positions_set_updated_at
before update on public.inventory_positions
for each row execute procedure private.set_updated_at();

create table public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.inventory_locations (id) on delete restrict,
  product_variant_id uuid not null references public.product_variants (id) on delete restrict,
  before_estimated_units integer,
  after_estimated_units integer not null,
  reason text not null,
  memo text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_adjustments_after_nonneg check (after_estimated_units >= 0),
  constraint inventory_adjustments_before_nonneg check (before_estimated_units is null or before_estimated_units >= 0),
  constraint inventory_adjustments_reason_not_blank check (length(trim(reason)) > 0)
);

comment on table public.inventory_adjustments is 'Set operational stock to a confirmed approximate count. Does not rewrite movements.';

create index inventory_adjustments_location_idx
  on public.inventory_adjustments (location_id, created_at desc);

create table public.inventory_movement_counters (
  day date primary key,
  last_n integer not null
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_no text not null unique,
  source_location_id uuid not null references public.inventory_locations (id) on delete restrict,
  destination_location_id uuid not null references public.inventory_locations (id) on delete restrict,
  status text not null default 'DRAFT',
  source_event_inventory_check_id uuid references public.event_inventory_checks (id) on delete set null,
  memo text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dispatched_at timestamptz,
  dispatched_by uuid references public.profiles (id) on delete set null,
  received_at timestamptz,
  received_by uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  constraint inventory_movements_status_allowed check (status in ('DRAFT', 'DISPATCHED', 'RECEIVED', 'CANCELLED')),
  constraint inventory_movements_distinct_ends check (source_location_id <> destination_location_id)
);

comment on table public.inventory_movements is 'Approximate stock transfer between two locations. One destination per movement.';

create index inventory_movements_source_idx
  on public.inventory_movements (source_location_id, status);

create index inventory_movements_dest_idx
  on public.inventory_movements (destination_location_id, status);

create index inventory_movements_created_idx
  on public.inventory_movements (created_at desc);

create trigger inventory_movements_set_updated_at
before update on public.inventory_movements
for each row execute procedure private.set_updated_at();

create table public.inventory_movement_items (
  id uuid primary key default gen_random_uuid(),
  inventory_movement_id uuid not null references public.inventory_movements (id) on delete restrict,
  product_variant_id uuid not null references public.product_variants (id) on delete restrict,
  sent_full_pack_count integer not null,
  sent_remainder_level text not null,
  sent_estimated_units integer not null,
  received_full_pack_count integer,
  received_remainder_level text,
  received_estimated_units integer,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_movement_items_sent_packs_nonneg check (sent_full_pack_count >= 0),
  constraint inventory_movement_items_sent_units_nonneg check (sent_estimated_units >= 0),
  constraint inventory_movement_items_sent_remainder_allowed check (
    sent_remainder_level in ('ZERO', 'VERY_LOW', 'HALF', 'HIGH', 'FULL')
  ),
  constraint inventory_movement_items_received_pair check (
    (received_full_pack_count is null and received_remainder_level is null and received_estimated_units is null)
    or (
      received_full_pack_count is not null
      and received_remainder_level is not null
      and received_estimated_units is not null
    )
  ),
  constraint inventory_movement_items_received_packs_nonneg check (
    received_full_pack_count is null or received_full_pack_count >= 0
  ),
  constraint inventory_movement_items_received_units_nonneg check (
    received_estimated_units is null or received_estimated_units >= 0
  ),
  constraint inventory_movement_items_received_remainder_allowed check (
    received_remainder_level is null
    or received_remainder_level in ('ZERO', 'VERY_LOW', 'HALF', 'HIGH', 'FULL')
  ),
  constraint inventory_movement_items_sku_uidx unique (inventory_movement_id, product_variant_id)
);

comment on table public.inventory_movement_items is 'Sent vs received approximate quantities. Difference is not inferred as sales or loss.';

create index inventory_movement_items_movement_idx
  on public.inventory_movement_items (inventory_movement_id);

create trigger inventory_movement_items_set_updated_at
before update on public.inventory_movement_items
for each row execute procedure private.set_updated_at();

create or replace function private.guard_inventory_movement_header()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'movement_immutable';
  end if;
  if old.status in ('RECEIVED', 'CANCELLED') then
    raise exception 'movement_immutable';
  end if;
  if old.status = 'DISPATCHED' and new.status not in ('DISPATCHED', 'RECEIVED') then
    raise exception 'not_cancellable';
  end if;
  return new;
end;
$$;

create trigger inventory_movements_guard
before update or delete on public.inventory_movements
for each row execute procedure private.guard_inventory_movement_header();

create or replace function private.guard_inventory_movement_items()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.inventory_movements
  where id = coalesce(new.inventory_movement_id, old.inventory_movement_id);
  if v_status in ('RECEIVED', 'CANCELLED') then
    raise exception 'movement_immutable';
  end if;
  if v_status = 'DISPATCHED' and tg_op = 'DELETE' then
    raise exception 'movement_immutable';
  end if;
  if v_status = 'DISPATCHED' and tg_op = 'INSERT' then
    raise exception 'movement_immutable';
  end if;
  if v_status = 'DISPATCHED' and tg_op = 'UPDATE' then
    if new.product_variant_id is distinct from old.product_variant_id
      or new.sent_full_pack_count is distinct from old.sent_full_pack_count
      or new.sent_remainder_level is distinct from old.sent_remainder_level
      or new.sent_estimated_units is distinct from old.sent_estimated_units then
      raise exception 'movement_immutable';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger inventory_movement_items_guard
before insert or update or delete on public.inventory_movement_items
for each row execute procedure private.guard_inventory_movement_items();

create or replace function public.next_inventory_movement_no()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date;
  v_n integer;
begin
  v_day := (timezone('Asia/Seoul', now()))::date;
  insert into public.inventory_movement_counters (day, last_n)
  values (v_day, 1)
  on conflict (day) do update
  set last_n = public.inventory_movement_counters.last_n + 1
  returning last_n into v_n;
  return 'MV-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_n::text, 4, '0');
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
  v_location_id uuid;
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

  select id into v_location_id
  from public.inventory_locations
  where event_id = v_check.event_id
    and location_type = 'EVENT'
  for update;
  if v_location_id is null then
    insert into public.inventory_locations (location_type, name, event_id)
    select 'EVENT', e.name, e.id
    from public.events as e
    where e.id = v_check.event_id
    returning id into v_location_id;
  end if;

  insert into public.inventory_positions (
    location_id,
    product_variant_id,
    estimated_units,
    last_physical_check_id,
    updated_by
  )
  select
    v_location_id,
    i.product_variant_id,
    i.full_pack_count * i.pack_size_snapshot + private.remainder_midpoint(i.remainder_level),
    p_check_id,
    p_confirmed_by
  from public.event_inventory_check_items as i
  where i.inventory_check_id = p_check_id
    and i.full_pack_count is not null
    and i.remainder_level is not null
  on conflict (location_id, product_variant_id) do update
  set
    estimated_units = excluded.estimated_units,
    last_physical_check_id = excluded.last_physical_check_id,
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

insert into public.inventory_positions (
  location_id, product_variant_id, estimated_units, last_physical_check_id, updated_by
)
select
  l.id,
  c.product_variant_id,
  c.full_pack_count * c.pack_size_snapshot + private.remainder_midpoint(c.remainder_level),
  c.source_check_id,
  c.updated_by
from public.event_inventory_current as c
join public.inventory_locations as l
  on l.event_id = c.event_id and l.location_type = 'EVENT'
on conflict (location_id, product_variant_id) do nothing;

create or replace function public.dispatch_inventory_movement(
  p_movement_id uuid,
  p_dispatched_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_move public.inventory_movements;
  v_item record;
  v_pos public.inventory_positions;
  v_dest public.inventory_locations;
  v_ok boolean;
begin
  select * into v_move
  from public.inventory_movements
  where id = p_movement_id
  for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_move.status = 'DISPATCHED' or v_move.status = 'RECEIVED' then
    raise exception 'already_dispatched';
  end if;
  if v_move.status is distinct from 'DRAFT' then
    raise exception 'not_draft';
  end if;

  select * into v_dest
  from public.inventory_locations
  where id = v_move.destination_location_id;

  if not exists (
    select 1 from public.inventory_movement_items where inventory_movement_id = p_movement_id
  ) then
    raise exception 'empty_movement';
  end if;

  for v_item in
    select * from public.inventory_movement_items
    where inventory_movement_id = p_movement_id
    for update
  loop
    if v_dest.location_type = 'EVENT' then
      select exists (
        select 1
        from public.event_assortment_items as a
        where a.event_id = v_dest.event_id
          and a.product_variant_id = v_item.product_variant_id
          and a.removed_at is null
      ) into v_ok;
      if not v_ok then
        raise exception 'sku_not_in_assortment';
      end if;
    end if;

    select * into v_pos
    from public.inventory_positions
    where location_id = v_move.source_location_id
      and product_variant_id = v_item.product_variant_id
    for update;
    if not found then
      raise exception 'insufficient_stock';
    end if;
    if v_pos.estimated_units < v_item.sent_estimated_units then
      raise exception 'insufficient_stock';
    end if;

    update public.inventory_positions
    set
      estimated_units = estimated_units - v_item.sent_estimated_units,
      updated_by = p_dispatched_by,
      updated_at = now()
    where id = v_pos.id
      and estimated_units - v_item.sent_estimated_units >= 0;
    if not found then
      raise exception 'insufficient_stock';
    end if;
  end loop;

  update public.inventory_movements
  set
    status = 'DISPATCHED',
    dispatched_at = now(),
    dispatched_by = p_dispatched_by
  where id = p_movement_id
    and status = 'DRAFT';
  if not found then
    raise exception 'already_dispatched';
  end if;

  return jsonb_build_object('id', p_movement_id, 'status', 'DISPATCHED');
end;
$$;

create or replace function public.receive_inventory_movement(
  p_movement_id uuid,
  p_received_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_move public.inventory_movements;
  v_item record;
  v_units integer;
begin
  select * into v_move
  from public.inventory_movements
  where id = p_movement_id
  for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_move.status = 'RECEIVED' then
    raise exception 'already_received';
  end if;
  if v_move.status is distinct from 'DISPATCHED' then
    raise exception 'not_dispatched';
  end if;

  for v_item in
    select * from public.inventory_movement_items
    where inventory_movement_id = p_movement_id
    for update
  loop
    if v_item.received_estimated_units is null then
      raise exception 'unchecked_receive';
    end if;
    v_units := v_item.received_estimated_units;

    insert into public.inventory_positions (
      location_id, product_variant_id, estimated_units, updated_by
    ) values (
      v_move.destination_location_id, v_item.product_variant_id, v_units, p_received_by
    )
    on conflict (location_id, product_variant_id) do update
    set
      estimated_units = public.inventory_positions.estimated_units + excluded.estimated_units,
      updated_by = excluded.updated_by,
      updated_at = now();
  end loop;

  update public.inventory_movements
  set
    status = 'RECEIVED',
    received_at = now(),
    received_by = p_received_by
  where id = p_movement_id
    and status = 'DISPATCHED';
  if not found then
    raise exception 'already_received';
  end if;

  return jsonb_build_object('id', p_movement_id, 'status', 'RECEIVED');
end;
$$;

create or replace function public.apply_inventory_adjustment(
  p_location_id uuid,
  p_product_variant_id uuid,
  p_after_units integer,
  p_reason text,
  p_memo text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before integer;
  v_id uuid;
begin
  if p_after_units is null or p_after_units < 0 then
    raise exception 'invalid_units';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'invalid_reason';
  end if;

  select estimated_units into v_before
  from public.inventory_positions
  where location_id = p_location_id
    and product_variant_id = p_product_variant_id
  for update;

  insert into public.inventory_adjustments (
    location_id, product_variant_id, before_estimated_units, after_estimated_units, reason, memo, created_by
  ) values (
    p_location_id, p_product_variant_id, v_before, p_after_units, trim(p_reason), p_memo, p_created_by
  ) returning id into v_id;

  insert into public.inventory_positions (
    location_id, product_variant_id, estimated_units, updated_by
  ) values (
    p_location_id, p_product_variant_id, p_after_units, p_created_by
  )
  on conflict (location_id, product_variant_id) do update
  set
    estimated_units = excluded.estimated_units,
    updated_by = excluded.updated_by,
    updated_at = now();

  return jsonb_build_object('id', v_id, 'before', v_before, 'after', p_after_units);
end;
$$;

create or replace function public.create_closing_movements(
  p_check_id uuid,
  p_created_by uuid,
  p_groups jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check public.event_inventory_checks;
  v_source uuid;
  v_group jsonb;
  v_item jsonb;
  v_move_id uuid;
  v_no text;
  v_ids uuid[] := '{}';
begin
  select * into v_check from public.event_inventory_checks where id = p_check_id;
  if not found then
    raise exception 'not_found';
  end if;
  if v_check.status is distinct from 'CONFIRMED' or v_check.check_kind is distinct from 'CLOSING' then
    raise exception 'not_closing';
  end if;
  select id into v_source
  from public.inventory_locations
  where event_id = v_check.event_id and location_type = 'EVENT';
  if v_source is null then
    raise exception 'not_found';
  end if;

  for v_group in select * from jsonb_array_elements(p_groups)
  loop
    if v_source = (v_group->>'destination_location_id')::uuid then
      raise exception 'same_location';
    end if;
    v_no := public.next_inventory_movement_no();
    insert into public.inventory_movements (
      movement_no, source_location_id, destination_location_id, status,
      source_event_inventory_check_id, created_by
    ) values (
      v_no, v_source, (v_group->>'destination_location_id')::uuid, 'DRAFT',
      p_check_id, p_created_by
    ) returning id into v_move_id;

    for v_item in select * from jsonb_array_elements(v_group->'items')
    loop
      insert into public.inventory_movement_items (
        inventory_movement_id,
        product_variant_id,
        sent_full_pack_count,
        sent_remainder_level,
        sent_estimated_units
      ) values (
        v_move_id,
        (v_item->>'product_variant_id')::uuid,
        (v_item->>'sent_full_pack_count')::integer,
        v_item->>'sent_remainder_level',
        (v_item->>'sent_estimated_units')::integer
      );
    end loop;
    v_ids := array_append(v_ids, v_move_id);
  end loop;

  return jsonb_build_object('movement_ids', to_jsonb(v_ids));
end;
$$;

revoke all on function public.next_inventory_movement_no() from public;
revoke all on function public.dispatch_inventory_movement(uuid, uuid) from public;
revoke all on function public.receive_inventory_movement(uuid, uuid) from public;
revoke all on function public.apply_inventory_adjustment(uuid, uuid, integer, text, text, uuid) from public;
revoke all on function public.create_closing_movements(uuid, uuid, jsonb) from public;
revoke execute on function public.next_inventory_movement_no() from anon, authenticated;
revoke execute on function public.dispatch_inventory_movement(uuid, uuid) from anon, authenticated;
revoke execute on function public.receive_inventory_movement(uuid, uuid) from anon, authenticated;
revoke execute on function public.apply_inventory_adjustment(uuid, uuid, integer, text, text, uuid) from anon, authenticated;
revoke execute on function public.create_closing_movements(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.next_inventory_movement_no() to service_role;
grant execute on function public.dispatch_inventory_movement(uuid, uuid) to service_role;
grant execute on function public.receive_inventory_movement(uuid, uuid) to service_role;
grant execute on function public.apply_inventory_adjustment(uuid, uuid, integer, text, text, uuid) to service_role;
grant execute on function public.create_closing_movements(uuid, uuid, jsonb) to service_role;

create or replace function private.can_read_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_admin_user(), false)
    or exists (
      select 1
      from public.inventory_locations as l
      where l.id = p_location_id
        and l.location_type = 'EVENT'
        and private.can_read_event(l.event_id)
    );
$$;

create or replace function private.can_read_movement(p_movement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_admin_user(), false)
    or exists (
      select 1
      from public.inventory_movements as m
      join public.inventory_locations as s on s.id = m.source_location_id
      join public.inventory_locations as d on d.id = m.destination_location_id
      where m.id = p_movement_id
        and (
          (s.location_type = 'EVENT' and private.can_read_event(s.event_id))
          or (d.location_type = 'EVENT' and private.can_read_event(d.event_id))
        )
    );
$$;

revoke all on function private.can_read_location(uuid) from public;
revoke all on function private.can_read_movement(uuid) from public;
grant execute on function private.can_read_location(uuid) to authenticated;
grant execute on function private.can_read_movement(uuid) to authenticated;

alter table public.inventory_locations enable row level security;
alter table public.inventory_locations force row level security;
alter table public.inventory_positions enable row level security;
alter table public.inventory_positions force row level security;
alter table public.inventory_adjustments enable row level security;
alter table public.inventory_adjustments force row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_movements force row level security;
alter table public.inventory_movement_items enable row level security;
alter table public.inventory_movement_items force row level security;
alter table public.inventory_movement_counters enable row level security;
alter table public.inventory_movement_counters force row level security;

revoke all on table public.inventory_locations from anon, authenticated, public;
revoke all on table public.inventory_positions from anon, authenticated, public;
revoke all on table public.inventory_adjustments from anon, authenticated, public;
revoke all on table public.inventory_movements from anon, authenticated, public;
revoke all on table public.inventory_movement_items from anon, authenticated, public;
revoke all on table public.inventory_movement_counters from anon, authenticated, public;

grant select on table public.inventory_locations to authenticated;
grant select on table public.inventory_positions to authenticated;
grant select on table public.inventory_adjustments to authenticated;
grant select on table public.inventory_movements to authenticated;
grant select on table public.inventory_movement_items to authenticated;

create policy inventory_locations_select
on public.inventory_locations for select to authenticated
using (private.can_read_location(id));

create policy inventory_positions_select
on public.inventory_positions for select to authenticated
using (private.can_read_location(location_id));

create policy inventory_adjustments_select
on public.inventory_adjustments for select to authenticated
using (private.is_admin_user());

create policy inventory_movements_select
on public.inventory_movements for select to authenticated
using (private.can_read_movement(id));

create policy inventory_movement_items_select
on public.inventory_movement_items for select to authenticated
using (private.can_read_movement(inventory_movement_id));
