-- Trigger functions are invoked by PostgreSQL triggers and must not be exposed as public RPCs.
revoke execute on function public.lji_set_opportunity_geo_verification() from public, anon, authenticated;
grant execute on function public.lji_set_opportunity_geo_verification() to service_role;

-- Least-privilege table grants. RLS remains the row-level authorization boundary.
revoke all on table public.lji_activity_log from anon;
revoke update, delete, truncate, references, trigger on table public.lji_activity_log from authenticated;
grant select, insert on table public.lji_activity_log to authenticated;

revoke all on table public.lji_lead_blocklist from anon;
revoke update, truncate, references, trigger on table public.lji_lead_blocklist from authenticated;
grant select, insert, delete on table public.lji_lead_blocklist to authenticated;

revoke all on table public.lji_match_alerts from anon;
revoke insert, update, delete, truncate, references, trigger on table public.lji_match_alerts from authenticated;
grant select on table public.lji_match_alerts to authenticated;
