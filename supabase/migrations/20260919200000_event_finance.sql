-- Phase 8 event sales, expenses, P&L inputs, audit.
-- No POS, COGS engine, purchase orders, or inventory deduction.

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_categories_code_not_blank check (length(trim(code)) > 0),
  constraint expense_categories_name_not_blank check (length(trim(name)) > 0)
);

create trigger expense_categories_set_updated_at
before update on public.expense_categories
for each row execute procedure private.set_updated_at();

insert into public.expense_categories (code, name, sort_order) values
  ('FOOD', '식비', 10),
  ('PARKING', '주차비', 20),
  ('TRANSPORT', '교통비', 30),
  ('LODGING', '숙박비', 40),
  ('DELIVERY', '배송·택배', 50),
  ('SUPPLIES', '행사물품', 60),
  ('LABOR', '인건비', 70),
  ('OTHER', '기타', 80);

create table public.event_daily_sales (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  business_date date not null,
  card_amount numeric(14, 0) not null default 0,
  cash_amount numeric(14, 0) not null default 0,
  other_amount numeric(14, 0) not null default 0,
  memo text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_daily_sales_amounts_nonneg check (
    card_amount >= 0 and cash_amount >= 0 and other_amount >= 0
  ),
  constraint event_daily_sales_event_date_uidx unique (event_id, business_date)
);

comment on table public.event_daily_sales is 'Manual daily sales. Missing row = not entered. Zero amounts = confirmed zero. Sum is computed.';

create index event_daily_sales_event_idx on public.event_daily_sales (event_id, business_date);

create trigger event_daily_sales_set_updated_at
before update on public.event_daily_sales
for each row execute procedure private.set_updated_at();

create table public.event_expenses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  expense_date date not null,
  expense_category_id uuid not null references public.expense_categories (id) on delete restrict,
  amount numeric(14, 0) not null,
  payment_method text not null,
  description text,
  memo text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  constraint event_expenses_amount_nonneg check (amount >= 0),
  constraint event_expenses_payment_allowed check (payment_method in ('CARD', 'CASH', 'OTHER'))
);

comment on table public.event_expenses is 'Event operating expense. voided_at excludes from P&L. Dates may fall outside the event window.';

create index event_expenses_event_idx on public.event_expenses (event_id, expense_date);

create trigger event_expenses_set_updated_at
before update on public.event_expenses
for each row execute procedure private.set_updated_at();

create table public.event_expense_receipts (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.event_expenses (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete restrict,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  file_size integer not null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint event_expense_receipts_path_not_blank check (length(trim(storage_path)) > 0),
  constraint event_expense_receipts_size_positive check (file_size > 0)
);

create index event_expense_receipts_expense_idx on public.event_expense_receipts (expense_id);

create table public.event_financial_inputs (
  event_id uuid primary key references public.events (id) on delete restrict,
  estimated_product_cost numeric(14, 0),
  memo text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint event_financial_inputs_cost_nonneg check (
    estimated_product_cost is null or estimated_product_cost >= 0
  )
);

comment on table public.event_financial_inputs is 'NULL cost = not entered. 0 = confirmed zero. ADMIN only.';

create trigger event_financial_inputs_set_updated_at
before update on public.event_financial_inputs
for each row execute procedure private.set_updated_at();

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events (id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now(),
  constraint audit_logs_entity_type_allowed check (
    entity_type in ('DAILY_SALES', 'EXPENSE', 'PRODUCT_COST')
  ),
  constraint audit_logs_action_allowed check (action in ('CREATE', 'UPDATE', 'VOID'))
);

create index audit_logs_event_idx on public.audit_logs (event_id, created_at desc);

create or replace function private.write_audit(
  p_event_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_actor uuid,
  p_before jsonb,
  p_after jsonb,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    event_id, entity_type, entity_id, action, actor_profile_id, before_data, after_data, reason
  ) values (
    p_event_id, p_entity_type, p_entity_id, p_action, p_actor, p_before, p_after, p_reason
  );
end;
$$;

revoke all on function private.write_audit(uuid, text, uuid, text, uuid, jsonb, jsonb, text) from public;
revoke execute on function private.write_audit(uuid, text, uuid, text, uuid, jsonb, jsonb, text) from anon, authenticated;

create or replace function private.event_business_range(p_event public.events)
returns daterange
language sql
stable
set search_path = ''
as $$
  select daterange(
    (timezone('Asia/Seoul', p_event.starts_at))::date,
    (timezone('Asia/Seoul', p_event.ends_at))::date,
    '[]'
  );
$$;

create or replace function public.save_event_daily_sales(
  p_event_id uuid,
  p_business_date date,
  p_card numeric,
  p_cash numeric,
  p_other numeric,
  p_memo text,
  p_expected_updated_at timestamptz,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_row public.event_daily_sales;
  v_after public.event_daily_sales;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then raise exception 'not_found'; end if;
  if p_card is null or p_cash is null or p_other is null
     or p_card < 0 or p_cash < 0 or p_other < 0
     or p_card <> trunc(p_card) or p_cash <> trunc(p_cash) or p_other <> trunc(p_other) then
    raise exception 'invalid_amount';
  end if;
  if not (private.event_business_range(v_event) @> p_business_date) then
    raise exception 'date_out_of_range';
  end if;

  select * into v_row
  from public.event_daily_sales
  where event_id = p_event_id and business_date = p_business_date
  for update;

  if found then
    if p_expected_updated_at is null or p_expected_updated_at is distinct from v_row.updated_at then
      raise exception 'conflict';
    end if;
    update public.event_daily_sales
    set
      card_amount = p_card,
      cash_amount = p_cash,
      other_amount = p_other,
      memo = p_memo,
      updated_by = p_actor
    where id = v_row.id
    returning * into v_after;
    perform private.write_audit(
      p_event_id, 'DAILY_SALES', v_row.id, 'UPDATE', p_actor,
      to_jsonb(v_row), to_jsonb(v_after)
    );
  else
    insert into public.event_daily_sales (
      event_id, business_date, card_amount, cash_amount, other_amount, memo, created_by, updated_by
    ) values (
      p_event_id, p_business_date, p_card, p_cash, p_other, p_memo, p_actor, p_actor
    ) returning * into v_after;
    perform private.write_audit(
      p_event_id, 'DAILY_SALES', v_after.id, 'CREATE', p_actor,
      null, to_jsonb(v_after)
    );
  end if;

  return to_jsonb(v_after);
end;
$$;

create or replace function public.save_event_expense(
  p_id uuid,
  p_event_id uuid,
  p_expense_date date,
  p_category_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_description text,
  p_memo text,
  p_expected_updated_at timestamptz,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.event_expenses;
  v_after public.event_expenses;
begin
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'not_found';
  end if;
  if p_amount is null or p_amount < 0 or p_amount <> trunc(p_amount) then
    raise exception 'invalid_amount';
  end if;
  if p_payment_method not in ('CARD', 'CASH', 'OTHER') then
    raise exception 'invalid_payment';
  end if;
  if p_expense_date is null or p_category_id is null then
    raise exception 'invalid_input';
  end if;
  if not exists (select 1 from public.expense_categories where id = p_category_id and is_active) then
    raise exception 'invalid_category';
  end if;

  if p_id is null then
    insert into public.event_expenses (
      event_id, expense_date, expense_category_id, amount, payment_method, description, memo, created_by, updated_by
    ) values (
      p_event_id, p_expense_date, p_category_id, p_amount, p_payment_method, p_description, p_memo, p_actor, p_actor
    ) returning * into v_after;
    perform private.write_audit(p_event_id, 'EXPENSE', v_after.id, 'CREATE', p_actor, null, to_jsonb(v_after));
    return to_jsonb(v_after);
  end if;

  select * into v_row from public.event_expenses where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_row.event_id is distinct from p_event_id then raise exception 'not_found'; end if;
  if v_row.voided_at is not null then raise exception 'voided'; end if;
  if p_expected_updated_at is null or p_expected_updated_at is distinct from v_row.updated_at then
    raise exception 'conflict';
  end if;

  update public.event_expenses
  set
    expense_date = p_expense_date,
    expense_category_id = p_category_id,
    amount = p_amount,
    payment_method = p_payment_method,
    description = p_description,
    memo = p_memo,
    updated_by = p_actor
  where id = p_id
  returning * into v_after;
  perform private.write_audit(p_event_id, 'EXPENSE', p_id, 'UPDATE', p_actor, to_jsonb(v_row), to_jsonb(v_after));
  return to_jsonb(v_after);
end;
$$;

create or replace function public.void_event_expense(
  p_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.event_expenses;
  v_after public.event_expenses;
begin
  select * into v_row from public.event_expenses where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_row.voided_at is not null then raise exception 'already_voided'; end if;
  update public.event_expenses
  set voided_at = now(), voided_by = p_actor, updated_by = p_actor
  where id = p_id
  returning * into v_after;
  perform private.write_audit(v_row.event_id, 'EXPENSE', p_id, 'VOID', p_actor, to_jsonb(v_row), to_jsonb(v_after));
  return to_jsonb(v_after);
end;
$$;

create or replace function public.save_event_product_cost(
  p_event_id uuid,
  p_cost numeric,
  p_memo text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.event_financial_inputs;
  v_after public.event_financial_inputs;
begin
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'not_found';
  end if;
  if p_cost is not null and (p_cost < 0 or p_cost <> trunc(p_cost)) then
    raise exception 'invalid_amount';
  end if;

  select * into v_before from public.event_financial_inputs where event_id = p_event_id for update;
  insert into public.event_financial_inputs (event_id, estimated_product_cost, memo, updated_by)
  values (p_event_id, p_cost, p_memo, p_actor)
  on conflict (event_id) do update
  set
    estimated_product_cost = excluded.estimated_product_cost,
    memo = excluded.memo,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into v_after;
  perform private.write_audit(
    p_event_id, 'PRODUCT_COST', p_event_id,
    case when v_before.event_id is null then 'CREATE' else 'UPDATE' end,
    p_actor,
    case when v_before.event_id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after)
  );
  return to_jsonb(v_after);
end;
$$;

create or replace function public.event_finance_summary(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_sales numeric := 0;
  v_card numeric := 0;
  v_cash numeric := 0;
  v_other numeric := 0;
  v_expense numeric := 0;
  v_cost numeric;
  v_commission numeric := 0;
  v_fee numeric := 0;
  v_profit numeric;
  v_days jsonb;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then raise exception 'not_found'; end if;

  select
    coalesce(sum(card_amount), 0),
    coalesce(sum(cash_amount), 0),
    coalesce(sum(other_amount), 0)
  into v_card, v_cash, v_other
  from public.event_daily_sales
  where event_id = p_event_id;
  v_sales := v_card + v_cash + v_other;

  select coalesce(sum(amount), 0) into v_expense
  from public.event_expenses
  where event_id = p_event_id and voided_at is null;

  select estimated_product_cost into v_cost
  from public.event_financial_inputs
  where event_id = p_event_id;

  if v_event.contract_type in ('COMMISSION', 'MIXED') then
    v_commission := round(v_sales * coalesce(v_event.commission_rate, 0) / 100);
  end if;
  if v_event.contract_type in ('FIXED_FEE', 'MIXED') then
    v_fee := coalesce(v_event.fixed_fee, 0);
  end if;
  if v_cost is not null then
    v_profit := v_sales - v_cost - v_expense - v_commission - v_fee;
  end if;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.business_date), '[]'::jsonb) into v_days
  from (
    select
      gs::date as business_date,
      case
        when s.id is null then 'missing'
        when s.card_amount = 0 and s.cash_amount = 0 and s.other_amount = 0 then 'zero'
        else 'entered'
      end as status,
      coalesce(s.card_amount + s.cash_amount + s.other_amount, 0) as total
    from generate_series(
      (timezone('Asia/Seoul', v_event.starts_at))::date,
      (timezone('Asia/Seoul', v_event.ends_at))::date,
      interval '1 day'
    ) as gs
    left join public.event_daily_sales as s
      on s.event_id = p_event_id and s.business_date = gs::date
  ) as d;

  return jsonb_build_object(
    'card_total', v_card,
    'cash_total', v_cash,
    'other_total', v_other,
    'sales_total', v_sales,
    'expense_total', v_expense,
    'estimated_product_cost', v_cost,
    'commission_amount', v_commission,
    'booth_fee', v_fee,
    'estimated_profit', v_profit,
    'profit_ready', (v_cost is not null),
    'days', v_days
  );
end;
$$;

revoke all on function public.save_event_daily_sales(uuid, date, numeric, numeric, numeric, text, timestamptz, uuid) from public;
revoke all on function public.save_event_expense(uuid, uuid, date, uuid, numeric, text, text, text, timestamptz, uuid) from public;
revoke all on function public.void_event_expense(uuid, uuid) from public;
revoke all on function public.save_event_product_cost(uuid, numeric, text, uuid) from public;
revoke all on function public.event_finance_summary(uuid) from public;
revoke execute on function public.save_event_daily_sales(uuid, date, numeric, numeric, numeric, text, timestamptz, uuid) from anon, authenticated;
revoke execute on function public.save_event_expense(uuid, uuid, date, uuid, numeric, text, text, text, timestamptz, uuid) from anon, authenticated;
revoke execute on function public.void_event_expense(uuid, uuid) from anon, authenticated;
revoke execute on function public.save_event_product_cost(uuid, numeric, text, uuid) from anon, authenticated;
revoke execute on function public.event_finance_summary(uuid) from anon, authenticated;
grant execute on function public.save_event_daily_sales(uuid, date, numeric, numeric, numeric, text, timestamptz, uuid) to service_role;
grant execute on function public.save_event_expense(uuid, uuid, date, uuid, numeric, text, text, text, timestamptz, uuid) to service_role;
grant execute on function public.void_event_expense(uuid, uuid) to service_role;
grant execute on function public.save_event_product_cost(uuid, numeric, text, uuid) to service_role;
grant execute on function public.event_finance_summary(uuid) to service_role;

alter table public.expense_categories enable row level security;
alter table public.expense_categories force row level security;
alter table public.event_daily_sales enable row level security;
alter table public.event_daily_sales force row level security;
alter table public.event_expenses enable row level security;
alter table public.event_expenses force row level security;
alter table public.event_expense_receipts enable row level security;
alter table public.event_expense_receipts force row level security;
alter table public.event_financial_inputs enable row level security;
alter table public.event_financial_inputs force row level security;
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

revoke all on table public.expense_categories from anon, authenticated, public;
revoke all on table public.event_daily_sales from anon, authenticated, public;
revoke all on table public.event_expenses from anon, authenticated, public;
revoke all on table public.event_expense_receipts from anon, authenticated, public;
revoke all on table public.event_financial_inputs from anon, authenticated, public;
revoke all on table public.audit_logs from anon, authenticated, public;

grant select on table public.expense_categories to authenticated;
grant select on table public.event_daily_sales to authenticated;
grant select on table public.event_expenses to authenticated;
grant select on table public.event_expense_receipts to authenticated;
grant select on table public.event_financial_inputs to authenticated;
grant select on table public.audit_logs to authenticated;

create policy expense_categories_select
on public.expense_categories for select to authenticated
using (private.has_app_access());

create policy event_daily_sales_select
on public.event_daily_sales for select to authenticated
using (private.can_read_event(event_id));

create policy event_expenses_select
on public.event_expenses for select to authenticated
using (private.can_read_event(event_id));

create policy event_expense_receipts_select
on public.event_expense_receipts for select to authenticated
using (private.can_read_event(event_id));

create policy event_financial_inputs_select
on public.event_financial_inputs for select to authenticated
using (private.is_admin_user());

create policy audit_logs_select
on public.audit_logs for select to authenticated
using (private.is_admin_user());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-receipts',
  'expense-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
);

create policy expense_receipts_storage_select
on storage.objects for select to authenticated
using (
  bucket_id = 'expense-receipts'
  and private.can_read_event(private.storage_event_id(name))
);

create policy expense_receipts_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'expense-receipts'
  and private.can_read_event(private.storage_event_id(name))
);

create policy expense_receipts_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'expense-receipts'
  and private.can_write_event(private.storage_event_id(name))
);
