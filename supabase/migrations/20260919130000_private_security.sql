-- Move SECURITY DEFINER helpers out of public. Do not edit Phase 0 migrations.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;
grant usage on schema private to service_role;

drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_select_self on public.profiles;

drop trigger if exists profiles_set_updated_at on public.profiles;
drop trigger if exists profiles_protect_master on public.profiles;

drop function if exists public.has_app_access();
drop function if exists public.current_app_role();
drop function if exists public.is_admin_user();
drop function if exists public.is_master_user();
drop function if exists public.protect_master_profile();
drop function if exists public.set_updated_at();

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create or replace function private.protect_master_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
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

create or replace function private.has_app_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = auth.uid()
      and p.is_active = true
      and (p.login_allowed_from is null or pg_catalog.now() >= p.login_allowed_from)
      and (p.login_allowed_until is null or pg_catalog.now() <= p.login_allowed_until)
  );
$$;

create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = auth.uid();
$$;

create or replace function private.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = auth.uid()
      and p.role = 'ADMIN'
      and p.is_active = true
      and (p.login_allowed_from is null or pg_catalog.now() >= p.login_allowed_from)
      and (p.login_allowed_until is null or pg_catalog.now() <= p.login_allowed_until)
  );
$$;

create or replace function private.is_master_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = auth.uid()
      and p.is_master = true
      and p.is_active = true
  );
$$;

revoke all on function private.has_app_access() from public;
revoke all on function private.current_app_role() from public;
revoke all on function private.is_admin_user() from public;
revoke all on function private.is_master_user() from public;

grant execute on function private.has_app_access() to authenticated;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.is_admin_user() to authenticated;
grant execute on function private.is_master_user() to authenticated;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute procedure private.set_updated_at();

create trigger profiles_protect_master
before update or delete on public.profiles
for each row
execute procedure private.protect_master_profile();

create policy profiles_select_self
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy profiles_select_admin
on public.profiles
for select
to authenticated
using (private.is_admin_user());
