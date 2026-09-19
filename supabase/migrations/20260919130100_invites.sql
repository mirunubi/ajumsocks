create table public.invites (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles (id)
);

create unique index invites_token_hash_uidx on public.invites (token_hash);
create unique index invites_one_active_uidx
  on public.invites (profile_id)
  where used_at is null and revoked_at is null;

comment on table public.invites is 'One-time invite tokens. Store hash only; never the raw token.';

alter table public.invites enable row level security;
alter table public.invites force row level security;

revoke all on table public.invites from anon, authenticated, public;
grant select on table public.invites to authenticated;

create policy invites_select_admin
on public.invites
for select
to authenticated
using (private.is_admin_user());
