-- Phase 4 Product Master. Do not start Phase 5 event product sets.

create sequence if not exists public.product_code_seq as bigint start with 1;

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.product_categories (id) on delete restrict,
  name text not null,
  code text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_parent_not_self check (parent_id is distinct from id)
);

create table public.sizes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.colors (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  color_family text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  product_code text not null unique,
  name text not null,
  primary_category_id uuid references public.product_categories (id) on delete set null,
  manufacturer_name text,
  wholesaler_name text,
  country_of_origin text,
  purchase_price numeric(12, 2),
  sale_price numeric(12, 2),
  default_pack_quantity integer not null default 10,
  is_active boolean not null default true,
  memo text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_not_blank check (length(trim(name)) > 0),
  constraint products_code_not_blank check (length(trim(product_code)) > 0),
  constraint products_pack_qty_positive check (default_pack_quantity > 0),
  constraint products_purchase_price_nonneg check (purchase_price is null or purchase_price >= 0),
  constraint products_sale_price_nonneg check (sale_price is null or sale_price >= 0),
  constraint products_country_allowed check (
    country_of_origin is null
    or country_of_origin in ('KR', 'CN', 'JP', 'OTHER')
  )
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  sku_code text not null unique,
  size_id uuid references public.sizes (id) on delete restrict,
  primary_color_id uuid references public.colors (id) on delete restrict,
  is_active boolean not null default true,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_sku_not_blank check (length(trim(sku_code)) > 0)
);

create table public.attribute_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  value_type text not null,
  unit text,
  option_values text[] not null default '{}',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attribute_definitions_type_allowed check (
    value_type in ('TEXT', 'NUMBER', 'BOOLEAN', 'SELECT')
  )
);

create table public.product_attribute_values (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  attribute_definition_id uuid not null references public.attribute_definitions (id) on delete restrict,
  value_text text,
  value_number numeric(12, 4),
  value_boolean boolean,
  option_value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, attribute_definition_id)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_name_not_blank check (length(trim(name)) > 0)
);

create table public.product_tags (
  product_id uuid not null references public.products (id) on delete restrict,
  tag_id uuid not null references public.tags (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (product_id, tag_id)
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  file_size integer not null,
  image_type text not null default 'other',
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint product_images_size_positive check (file_size > 0),
  constraint product_images_type_allowed check (
    image_type in ('front', 'back', 'pattern', 'package', 'other')
  )
);

create unique index product_images_one_primary
on public.product_images (product_id)
where is_primary;

create index product_variants_product_id_idx on public.product_variants (product_id);
create index products_primary_category_id_idx on public.products (primary_category_id);
create index product_images_product_id_idx on public.product_images (product_id);
create index product_attribute_values_product_id_idx on public.product_attribute_values (product_id);

create or replace function public.next_product_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n bigint;
  code text;
begin
  loop
    n := nextval('public.product_code_seq');
    code := 'AJ-' || lpad(n::text, 6, '0');
    exit when not exists (
      select 1 from public.products as p where p.product_code = code
    );
  end loop;
  return code;
end;
$$;

create or replace function public.next_sku_code(p_product_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  pc text;
  n integer;
  code text;
begin
  select p.product_code into pc
  from public.products as p
  where p.id = p_product_id;
  if pc is null then
    raise exception 'product_not_found';
  end if;

  select coalesce(
    (
      select max((regexp_match(v.sku_code, '^' || pc || '-([0-9]+)$'))[1]::integer)
      from public.product_variants as v
      where v.product_id = p_product_id
    ),
    0
  ) + 1 into n;

  loop
    code := pc || '-' || lpad(n::text, 2, '0');
    exit when not exists (
      select 1 from public.product_variants as v where v.sku_code = code
    );
    n := n + 1;
  end loop;
  return code;
end;
$$;

revoke all on function public.next_product_code() from public;
revoke all on function public.next_sku_code(uuid) from public;
revoke execute on function public.next_product_code() from anon, authenticated;
revoke execute on function public.next_sku_code(uuid) from anon, authenticated;
grant execute on function public.next_product_code() to service_role;
grant execute on function public.next_sku_code(uuid) to service_role;
grant usage, select on sequence public.product_code_seq to service_role;

create trigger product_categories_set_updated_at
before update on public.product_categories
for each row execute procedure private.set_updated_at();

create trigger sizes_set_updated_at
before update on public.sizes
for each row execute procedure private.set_updated_at();

create trigger colors_set_updated_at
before update on public.colors
for each row execute procedure private.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute procedure private.set_updated_at();

create trigger product_variants_set_updated_at
before update on public.product_variants
for each row execute procedure private.set_updated_at();

create trigger attribute_definitions_set_updated_at
before update on public.attribute_definitions
for each row execute procedure private.set_updated_at();

create trigger product_attribute_values_set_updated_at
before update on public.product_attribute_values
for each row execute procedure private.set_updated_at();

create trigger tags_set_updated_at
before update on public.tags
for each row execute procedure private.set_updated_at();

create or replace function private.storage_product_id(object_name text)
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

revoke all on function private.storage_product_id(text) from public;
revoke execute on function private.storage_product_id(text) from anon;
grant execute on function private.storage_product_id(text) to authenticated;

alter table public.product_categories enable row level security;
alter table public.product_categories force row level security;
alter table public.sizes enable row level security;
alter table public.sizes force row level security;
alter table public.colors enable row level security;
alter table public.colors force row level security;
alter table public.products enable row level security;
alter table public.products force row level security;
alter table public.product_variants enable row level security;
alter table public.product_variants force row level security;
alter table public.attribute_definitions enable row level security;
alter table public.attribute_definitions force row level security;
alter table public.product_attribute_values enable row level security;
alter table public.product_attribute_values force row level security;
alter table public.tags enable row level security;
alter table public.tags force row level security;
alter table public.product_tags enable row level security;
alter table public.product_tags force row level security;
alter table public.product_images enable row level security;
alter table public.product_images force row level security;

grant select on table public.product_categories to authenticated;
grant select on table public.sizes to authenticated;
grant select on table public.colors to authenticated;
grant select on table public.products to authenticated;
grant select on table public.product_variants to authenticated;
grant select on table public.attribute_definitions to authenticated;
grant select on table public.product_attribute_values to authenticated;
grant select on table public.tags to authenticated;
grant select on table public.product_tags to authenticated;
grant select on table public.product_images to authenticated;

create policy product_categories_select_access
on public.product_categories for select to authenticated
using (private.has_app_access());

create policy sizes_select_access
on public.sizes for select to authenticated
using (private.has_app_access());

create policy colors_select_access
on public.colors for select to authenticated
using (private.has_app_access());

create policy products_select_access
on public.products for select to authenticated
using (private.has_app_access());

create policy product_variants_select_access
on public.product_variants for select to authenticated
using (private.has_app_access());

create policy attribute_definitions_select_access
on public.attribute_definitions for select to authenticated
using (private.has_app_access());

create policy product_attribute_values_select_access
on public.product_attribute_values for select to authenticated
using (private.has_app_access());

create policy tags_select_access
on public.tags for select to authenticated
using (private.has_app_access());

create policy product_tags_select_access
on public.product_tags for select to authenticated
using (private.has_app_access());

create policy product_images_select_access
on public.product_images for select to authenticated
using (private.has_app_access());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
);

create policy product_images_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'product-images'
  and private.has_app_access()
);

create policy product_images_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and private.is_admin_user()
  and private.storage_product_id(name) is not null
);

create policy product_images_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and private.is_admin_user()
);

-- Audience categories. Sock style (중목/장목) is Attribute, not Category.
insert into public.product_categories (name, code, sort_order) values
  ('신생아', 'NEWBORN', 10),
  ('아동', 'KIDS', 20),
  ('성인', 'ADULT', 30),
  ('여성', 'ADULT_WOMEN', 31),
  ('남성', 'ADULT_MEN', 32);

update public.product_categories as child
set parent_id = parent.id
from public.product_categories as parent
where child.code in ('ADULT_WOMEN', 'ADULT_MEN')
  and parent.code = 'ADULT';

insert into public.sizes (code, display_name, sort_order) values
  ('NEWBORN', '신생아', 10),
  ('K1', '1호', 20),
  ('K2', '2호', 30),
  ('K3', '3호', 40),
  ('K4', '4호', 50),
  ('K5', '5호', 60),
  ('S', 'S', 70),
  ('M', 'M', 80),
  ('L', 'L', 90),
  ('XL', 'XL', 100);

insert into public.colors (code, name, color_family, sort_order) values
  ('BLACK', 'Black', 'BLACK', 10),
  ('WHITE', 'White', 'WHITE', 20),
  ('GRAY', 'Gray', 'GRAY', 30),
  ('BEIGE', 'Beige', 'BEIGE', 40),
  ('BROWN', 'Brown', 'BROWN', 50),
  ('PINK', 'Pink', 'PINK', 60),
  ('RED', 'Red', 'RED', 70),
  ('BLUE', 'Blue', 'BLUE', 80),
  ('NAVY', 'Navy', 'BLUE', 90),
  ('GREEN', 'Green', 'GREEN', 100),
  ('YELLOW', 'Yellow', 'YELLOW', 110),
  ('MULTI', 'Multi', 'MULTI', 120),
  ('OTHER', 'Other', 'OTHER', 130);

insert into public.attribute_definitions (code, name, value_type, unit, option_values, sort_order) values
  ('cotton_pct', '면 함량', 'NUMBER', '%', '{}', 10),
  ('polyester_pct', '폴리에스터 함량', 'NUMBER', '%', '{}', 20),
  ('polyurethane_pct', '폴리우레탄 함량', 'NUMBER', '%', '{}', 30),
  ('wool_pct', '울 함량', 'NUMBER', '%', '{}', 40),
  ('sock_style', '상품형태', 'SELECT', null, array['발가락', '니삭스', '덧신', '중목', '장목', '파일양말'], 50),
  ('color_pattern', '색상유형', 'SELECT', null, array['솔리드', '혼합', '멀티컬러'], 60);

insert into public.tags (name) values
  ('무압박'),
  ('돌돌이'),
  ('메쉬'),
  ('니트'),
  ('보온'),
  ('미끄럼방지'),
  ('캐릭터'),
  ('동물'),
  ('고양이');
