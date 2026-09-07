-- LJ v2 raw/internal tables are backend-only. RLS stays enabled as an additional barrier.
-- Client-facing access is provided through scoped RPCs/index tables rather than direct table grants.

do $block$
declare
  t text;
begin
  foreach t in array array[
    'lj_v2_activities','lj_v2_alerts','lj_v2_change_log','lj_v2_contacts',
    'lj_v2_images','lj_v2_leads','lj_v2_listing_contacts','lj_v2_listings',
    'lj_v2_notes','lj_v2_properties','lj_v2_quinto_checks','lj_v2_quinto_verifications',
    'lj_v2_saved_radars','lj_v2_sources'
  ]
  loop
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end
$block$;
