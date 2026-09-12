create table if not exists public.lji_router_auth_nonces (
  nonce text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists lji_router_auth_nonces_expiry_idx
  on public.lji_router_auth_nonces (expires_at);

create or replace function public.lji_consume_router_auth_nonce(
  p_nonce text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(length(trim(p_nonce)),0) < 16 or p_expires_at <= now() then
    return false;
  end if;

  delete from public.lji_router_auth_nonces where expires_at < now();
  insert into public.lji_router_auth_nonces(nonce, expires_at)
  values (trim(p_nonce), p_expires_at)
  on conflict (nonce) do nothing;
  return found;
end;
$function$;

revoke all on table public.lji_router_auth_nonces from public, anon, authenticated;
revoke all on function public.lji_consume_router_auth_nonce(text,timestamptz) from public, anon, authenticated;
grant execute on function public.lji_consume_router_auth_nonce(text,timestamptz) to service_role;
