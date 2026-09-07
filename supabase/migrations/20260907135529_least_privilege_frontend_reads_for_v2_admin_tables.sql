revoke all privileges on table public.lj_v2_collector_runs from anon, authenticated;
revoke all privileges on table public.lj_v2_security_audit from anon, authenticated;
revoke all privileges on table public.lj_v2_user_profiles from anon, authenticated;

grant select on table public.lj_v2_collector_runs to authenticated;
grant select on table public.lj_v2_security_audit to authenticated;
grant select on table public.lj_v2_user_profiles to authenticated;

grant select, insert, update, delete on table public.lj_v2_collector_runs to service_role;
grant select, insert, update, delete on table public.lj_v2_security_audit to service_role;
grant select, insert, update, delete on table public.lj_v2_user_profiles to service_role;
