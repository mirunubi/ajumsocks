-- Phase 0 profiles + RLS helpers.
-- Invite table is intentionally omitted; see comment at bottom (Phase 1).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null,
  display_name text not null,
  phone text not null,
  is_master boolean not null default false,
  is_active boolean not null default true,
  login_allowed_from timestamptz,
  login_allowed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_phone_not_blank check (char_length(phone) >= 10),
  constraint profiles_master_is_admin check (not is_master or role = 'ADMIN')
);

create unique index profiles_phone_uidx on public.profiles (phone);
create unique index profiles_one_master_uidx on public.profiles (is_master) where is_master;

comment on table public.profiles is 'App identity and access window. Auth session alone does not grant access.';
comment on column public.profiles.phone is 'E.164, e.g. +821012345678';
comment on column public.profiles.login_allowed_from is 'NULL means no start bound';
comment on column public.profiles.login_allowed_until is 'NULL means no end bound';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute procedure public.set_updated_at();

create or replace function public.protect_master_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_master and coalesce(auth.role(), '') is distinct from 'service_role' then
      raise exception 'MASTER 계정은 삭제할 수 없습니다.';
    end if;
    return old;
  end if;

  if coalesce(auth.role(), '') is distinct from 'service_role' then
    if new.is_master is distinct from old.is_master then
      raise exception 'MASTER 지정은 서버에서만 가능합니다.';
    end if;

    if old.is_master then
      if new.role is distinct from old.role
         or new.is_active is distinct from old.is_active then
        raise exception 'MASTER 계정은 삭제, 비활성화, 역할 강등할 수 없습니다.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_protect_master
before update or delete on public.profiles
for each row
execute procedure public.protect_master_profile();

create or replace function public.has_app_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (p.login_allowed_from is null or now() >= p.login_allowed_from)
      and (p.login_allowed_until is null or now() <= p.login_allowed_until)
  );
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'ADMIN'
      and p.is_active = true
      and (p.login_allowed_from is null or now() >= p.login_allowed_from)
      and (p.login_allowed_until is null or now() <= p.login_allowed_until)
  );
$$;

create or replace function public.is_master_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_master = true
      and p.is_active = true
  );
$$;

revoke all on function public.has_app_access() from public;
revoke all on function public.current_app_role() from public;
revoke all on function public.is_admin_user() from public;
revoke all on function public.is_master_user() from public;

grant execute on function public.has_app_access() to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_admin_user() to authenticated;
grant execute on function public.is_master_user() to authenticated;
grant usage on type public.app_role to authenticated, anon;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

revoke all on table public.profiles from anon, authenticated, public;
grant select on table public.profiles to authenticated;

-- Own row is readable so the client can show why access was denied.
create policy profiles_select_self
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy profiles_select_admin
on public.profiles
for select
to authenticated
using (public.is_admin_user());

-- Authenticated clients cannot insert/update/delete profiles.
-- Phase 1 provisioning uses service_role / Edge Function (bypasses RLS).

-- Phase 1 invite extension point (do not create in Phase 0):
--   public.invites (
--     id uuid primary key,
--     profile_id uuid not null references public.profiles (id),
--     token_hash text not null unique,
--     created_at timestamptz not null default now(),
--     expires_at timestamptz not null,
--     used_at timestamptz,
--     revoked_at timestamptz
--   )
-- Route: https://app.ajumsocks.co.kr/invite/{secure_token}
-- Token stored as hash only; original token returned once from Edge Function.
