-- Source Router URL safety / SSRF defense.
-- Mirrors the production guards validated on 2026-09-07.

create or replace function public.lji_server_fetch_url_safe(p_url text)
returns boolean
language plpgsql
immutable strict
set search_path to 'pg_catalog'
as $$
declare
  v text := lower(btrim(p_url));
  m text[];
  host text;
  port text;
  o1 integer;
  o2 integer;
  o3 integer;
  o4 integer;
begin
  if v !~ '^https?://' then return false; end if;
  if v ~ '^https?://[^/?#]*@' then return false; end if;

  m := regexp_match(v, '^https?://(\[[^]]+\]|[^/:?#]+)(?::([0-9]{1,5}))?(?:[/?#]|$)');
  if m is null then return false; end if;

  host := rtrim(m[1], '.');
  port := m[2];
  if port is not null and port not in ('80','443') then return false; end if;

  if host in ('localhost','localhost.localdomain','metadata.google.internal')
     or host like '%.localhost'
     or host like '%.local'
     or host like '%.internal'
     or host like '%.lan'
     or host like '%.home'
     or host like '%.onion'
  then return false; end if;

  if host like '[%]' or position(':' in host) > 0 then return false; end if;
  if host ~ '^[0-9]+$' or host ~ '^0x[0-9a-f]+$' then return false; end if;

  if host ~ '^([0-9]{1,3}\.){3}[0-9]{1,3}$' then
    o1 := split_part(host,'.',1)::integer;
    o2 := split_part(host,'.',2)::integer;
    o3 := split_part(host,'.',3)::integer;
    o4 := split_part(host,'.',4)::integer;
    if greatest(o1,o2,o3,o4) > 255 then return false; end if;
    if o1 = 0 or o1 = 10 or o1 = 127 then return false; end if;
    if o1 = 100 and o2 between 64 and 127 then return false; end if;
    if o1 = 169 and o2 = 254 then return false; end if;
    if o1 = 172 and o2 between 16 and 31 then return false; end if;
    if o1 = 192 and o2 in (0,168) then return false; end if;
    if o1 = 198 and o2 in (18,19) then return false; end if;
    if o1 >= 224 then return false; end if;
    return true;
  end if;

  if host !~ '^[a-z0-9.-]+$' then return false; end if;
  if host not like '%.%' then return false; end if;
  return true;
end;
$$;

create or replace function public.lji_is_safe_external_url(p_url text)
returns boolean
language plpgsql
immutable strict
set search_path to 'public'
as $$
declare
  v text := lower(btrim(p_url));
  v_authority text;
  v_host text;
  v_ip inet;
begin
  if v = '' or v !~ '^https?://' then return false; end if;

  v_authority := substring(v from '^https?://([^/?#]+)');
  if v_authority is null or v_authority = '' then return false; end if;
  if position('@' in v_authority) > 0 then return false; end if;
  if v_authority ~ ':([0-9]+)$' and v_authority !~ ':(80|443)$' then return false; end if;

  if v_authority ~ '^\[' then
    v_host := substring(v_authority from '^\[([^]]+)\]');
  else
    v_host := split_part(v_authority, ':', 1);
  end if;
  v_host := regexp_replace(coalesce(v_host,''), '\.$', '');

  if v_host = '' then return false; end if;
  if v_host = 'localhost' or v_host like '%.localhost' or v_host like '%.local' or v_host like '%.internal' then return false; end if;
  if v_host ~ '^[0-9]+$' or v_host ~ '^0x[0-9a-f]+$' then return false; end if;

  begin
    v_ip := v_host::inet;
    if v_ip <<= '0.0.0.0/8'::inet
       or v_ip <<= '10.0.0.0/8'::inet
       or v_ip <<= '100.64.0.0/10'::inet
       or v_ip <<= '127.0.0.0/8'::inet
       or v_ip <<= '169.254.0.0/16'::inet
       or v_ip <<= '172.16.0.0/12'::inet
       or v_ip <<= '192.0.0.0/24'::inet
       or v_ip <<= '192.168.0.0/16'::inet
       or v_ip <<= '198.18.0.0/15'::inet
       or v_ip <<= '224.0.0.0/4'::inet
       or v_ip <<= '240.0.0.0/4'::inet
       or v_ip <<= '::/128'::inet
       or v_ip <<= '::1/128'::inet
       or v_ip <<= 'fc00::/7'::inet
       or v_ip <<= 'fe80::/10'::inet
       or v_ip <<= 'ff00::/8'::inet then
      return false;
    end if;
  exception when invalid_text_representation then
    null;
  end;

  return true;
end;
$$;

create or replace function public.lji_guard_raw_discovery_url()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.original_url is null or not public.lji_is_safe_external_url(new.original_url) then
    raise exception 'unsafe_external_url';
  end if;
  return new;
end;
$$;

revoke all on function public.lji_guard_raw_discovery_url() from public;
revoke all on function public.lji_guard_raw_discovery_url() from anon;
revoke all on function public.lji_guard_raw_discovery_url() from authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.lj_v2_raw_discoveries'::regclass
      and conname='lj_v2_raw_discoveries_server_fetch_url_safe'
  ) then
    alter table public.lj_v2_raw_discoveries
      add constraint lj_v2_raw_discoveries_server_fetch_url_safe
      check (public.lji_server_fetch_url_safe(original_url));
  end if;
end $$;

drop trigger if exists lji_raw_discovery_safe_url_guard on public.lj_v2_raw_discoveries;
create trigger lji_raw_discovery_safe_url_guard
before insert or update of original_url on public.lj_v2_raw_discoveries
for each row execute function public.lji_guard_raw_discovery_url();
