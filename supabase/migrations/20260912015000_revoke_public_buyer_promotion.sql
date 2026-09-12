-- This promotion job is an internal backend operation. It must never be
-- callable by the public REST roles because it writes buyer records.
revoke execute on function public.lji_promote_buyer_intents(uuid)
  from public, anon, authenticated;

grant execute on function public.lji_promote_buyer_intents(uuid)
  to service_role;
