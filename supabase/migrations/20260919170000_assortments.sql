-- Phase 5 event assortment templates and snapshots.
-- No inventory quantity columns. Do not start Phase 6.

create table public.assortment_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assortment_sets_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.assortment_sets is 'Reusable SKU-scope templates. Not preparation sets. No stock quantities.';

create trigger assortment_sets_set_updated_at
before update on public.assortment_sets
for each row execute procedure private.set_updated_at();

create table public.assortment_set_rules (
  id uuid primary key default gen_random_uuid(),
  assortment_set_id uuid not null references public.assortment_sets (id) on delete cascade,
  category_id uuid references public.product_categories (id) on delete restrict,
  include_descendants boolean not null default true,
  tag_id uuid references public.tags (id) on delete restrict,
  size_id uuid references public.sizes (id) on delete restrict,
  color_id uuid references public.colors (id) on delete restrict,
  product_id uuid references public.products (id) on delete restrict,
  product_variant_id uuid references public.product_variants (id) on delete restrict,
  sort_order integer not null default 0,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assortment_set_rules_has_filter check (
    category_id is not null
    or tag_id is not null
    or size_id is not null
    or color_id is not null
    or product_id is not null
    or product_variant_id is not null
  )
);

comment on table public.assortment_set_rules is 'Simple AND filters per rule. Multiple rules are OR. Not a general query language.';

create index assortment_set_rules_set_idx
  on public.assortment_set_rules (assortment_set_id, sort_order);

create trigger assortment_set_rules_set_updated_at
before update on public.assortment_set_rules
for each row execute procedure private.set_updated_at();

create table public.event_assortments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  source_assortment_set_id uuid references public.assortment_sets (id) on delete restrict,
  applied_by uuid references public.profiles (id) on delete set null,
  applied_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_assortments_event_uidx unique (event_id)
);

comment on table public.event_assortments is 'One SKU-scope header per event. Re-apply is rejected to avoid overwrite.';

create trigger event_assortments_set_updated_at
before update on public.event_assortments
for each row execute procedure private.set_updated_at();

create table public.event_assortment_items (
  id uuid primary key default gen_random_uuid(),
  event_assortment_id uuid not null references public.event_assortments (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  product_variant_id uuid not null references public.product_variants (id) on delete restrict,
  source_rule_id uuid references public.assortment_set_rules (id) on delete set null,
  source_type text not null,
  product_code_snapshot text not null,
  product_name_snapshot text not null,
  sku_code_snapshot text not null,
  size_snapshot text,
  color_snapshot text,
  category_snapshot text,
  sort_order integer not null default 0,
  memo text,
  removed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_assortment_items_source_type_allowed check (source_type in ('TEMPLATE', 'MANUAL')),
  constraint event_assortment_items_variant_uidx unique (event_assortment_id, product_variant_id)
);

comment on table public.event_assortment_items is 'Per-event SKU snapshot. Display snapshot columns. Quantity belongs in Phase 6.';

create index event_assortment_items_event_idx
  on public.event_assortment_items (event_id)
  where removed_at is null;

create index event_assortment_items_variant_idx
  on public.event_assortment_items (product_variant_id);

create trigger event_assortment_items_set_updated_at
before update on public.event_assortment_items
for each row execute procedure private.set_updated_at();

create or replace function public.apply_event_assortment(
  p_event_id uuid,
  p_source_set_id uuid,
  p_applied_by uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_header public.event_assortments;
begin
  if exists (
    select 1 from public.event_assortments as a where a.event_id = p_event_id
  ) then
    raise exception 'assortment_exists';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_set';
  end if;

  insert into public.event_assortments (event_id, source_assortment_set_id, applied_by)
  values (p_event_id, p_source_set_id, p_applied_by)
  returning * into v_header;

  insert into public.event_assortment_items (
    event_assortment_id,
    event_id,
    product_id,
    product_variant_id,
    source_rule_id,
    source_type,
    product_code_snapshot,
    product_name_snapshot,
    sku_code_snapshot,
    size_snapshot,
    color_snapshot,
    category_snapshot,
    sort_order,
    created_by
  )
  select
    v_header.id,
    p_event_id,
    (item->>'product_id')::uuid,
    (item->>'product_variant_id')::uuid,
    nullif(item->>'source_rule_id', '')::uuid,
    coalesce(item->>'source_type', 'TEMPLATE'),
    item->>'product_code_snapshot',
    item->>'product_name_snapshot',
    item->>'sku_code_snapshot',
    nullif(item->>'size_snapshot', ''),
    nullif(item->>'color_snapshot', ''),
    nullif(item->>'category_snapshot', ''),
    coalesce((item->>'sort_order')::integer, 0),
    p_applied_by
  from jsonb_array_elements(p_items) as item;

  return jsonb_build_object('id', v_header.id, 'event_id', v_header.event_id);
end;
$$;

revoke all on function public.apply_event_assortment(uuid, uuid, uuid, jsonb) from public;
revoke execute on function public.apply_event_assortment(uuid, uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.apply_event_assortment(uuid, uuid, uuid, jsonb) to service_role;

alter table public.assortment_sets enable row level security;
alter table public.assortment_sets force row level security;
alter table public.assortment_set_rules enable row level security;
alter table public.assortment_set_rules force row level security;
alter table public.event_assortments enable row level security;
alter table public.event_assortments force row level security;
alter table public.event_assortment_items enable row level security;
alter table public.event_assortment_items force row level security;

revoke all on table public.assortment_sets from anon, authenticated, public;
revoke all on table public.assortment_set_rules from anon, authenticated, public;
revoke all on table public.event_assortments from anon, authenticated, public;
revoke all on table public.event_assortment_items from anon, authenticated, public;

grant select on table public.assortment_sets to authenticated;
grant select on table public.assortment_set_rules to authenticated;
grant select on table public.event_assortments to authenticated;
grant select on table public.event_assortment_items to authenticated;

create policy assortment_sets_select_admin
on public.assortment_sets for select to authenticated
using (private.is_admin_user());

create policy assortment_set_rules_select_admin
on public.assortment_set_rules for select to authenticated
using (private.is_admin_user());

create policy event_assortments_select_assigned
on public.event_assortments for select to authenticated
using (private.can_read_event(event_id));

create policy event_assortment_items_select_assigned
on public.event_assortment_items for select to authenticated
using (private.can_read_event(event_id));
