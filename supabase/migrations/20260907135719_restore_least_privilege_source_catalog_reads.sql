revoke all privileges on table public.lj_v2_sources from anon, authenticated;
revoke all privileges on table public.lj_v2_collector_source_profiles from anon, authenticated;

grant select on table public.lj_v2_sources to authenticated;
grant select on table public.lj_v2_collector_source_profiles to authenticated;

grant select, insert, update, delete on table public.lj_v2_sources to service_role;
grant select, insert, update, delete on table public.lj_v2_collector_source_profiles to service_role;

drop policy if exists lj_v2_sources_select on public.lj_v2_sources;
create policy lj_v2_sources_select
on public.lj_v2_sources
for select
to authenticated
using (public.lj_v2_is_active_user());
