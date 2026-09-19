-- Tighten EXECUTE on private SECURITY DEFINER helpers.
-- Do not edit 20260919130000_private_security.sql.

revoke all on function private.has_app_access() from public;
revoke all on function private.current_app_role() from public;
revoke all on function private.is_admin_user() from public;
revoke all on function private.is_master_user() from public;

revoke execute on function private.has_app_access() from anon;
revoke execute on function private.current_app_role() from anon;
revoke execute on function private.is_admin_user() from anon;
revoke execute on function private.is_master_user() from anon;

revoke execute on function private.current_app_role() from authenticated;
revoke execute on function private.is_master_user() from authenticated;

grant execute on function private.has_app_access() to authenticated;
grant execute on function private.is_admin_user() to authenticated;
