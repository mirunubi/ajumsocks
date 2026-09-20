-- Restrict authenticated SELECT of event contract amount columns.
-- Row RLS on events is unchanged. PostgreSQL RLS cannot hide columns.
-- ADMIN reads commission_rate / fixed_fee via Edge (Secret Key), not PostgREST.

revoke all on table public.events from authenticated;
grant select (
  id,
  name,
  starts_at,
  ends_at,
  status,
  venue_name,
  address,
  address_detail,
  memo,
  contract_type,
  contract_memo,
  created_by,
  created_at,
  updated_at
) on table public.events to authenticated;
