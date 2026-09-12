create table if not exists public.lji_whatsapp_webhook_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  phone_number_id text,
  message_id text not null,
  from_phone text,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, message_id)
);

create index if not exists lji_whatsapp_queue_claim_idx
  on public.lji_whatsapp_webhook_queue (status, available_at, locked_until);

create or replace function public.lji_claim_whatsapp_webhook_queue(p_limit integer default 5)
returns setof public.lji_whatsapp_webhook_queue
language plpgsql security definer set search_path to 'public'
as $function$
begin
  return query
  with picked as (
    select id from public.lji_whatsapp_webhook_queue
    where (status='pending' and available_at<=now())
       or (status='processing' and locked_until<now())
    order by created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,5),20))
  )
  update public.lji_whatsapp_webhook_queue q
  set status='processing', attempts=q.attempts+1, locked_until=now()+interval '2 minutes', updated_at=now()
  from picked where q.id=picked.id
  returning q.*;
end;
$function$;

create or replace function public.lji_finish_whatsapp_webhook_queue(p_id uuid, p_ok boolean, p_error text default null)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
begin
  update public.lji_whatsapp_webhook_queue
  set status=case when p_ok then 'completed' when attempts>=10 then 'failed' else 'pending' end,
      available_at=case when p_ok or attempts>=10 then available_at else now()+least(interval '30 minutes', interval '15 seconds' * greatest(attempts,1)) end,
      locked_until=null, last_error=case when p_ok then null else left(p_error,500) end, updated_at=now()
  where id=p_id;
  return found;
end;
$function$;

revoke all on table public.lji_whatsapp_webhook_queue from public, anon, authenticated;
revoke all on function public.lji_claim_whatsapp_webhook_queue(integer) from public, anon, authenticated;
revoke all on function public.lji_finish_whatsapp_webhook_queue(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.lji_claim_whatsapp_webhook_queue(integer) to service_role;
grant execute on function public.lji_finish_whatsapp_webhook_queue(uuid,boolean,text) to service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname='lji-whatsapp-webhook-queue-5m') then
    perform cron.schedule(
      'lji-whatsapp-webhook-queue-5m',
      '*/5 * * * *',
      $job$select net.http_post(
        url := 'https://aeuclswrxtqpcsexiobs.supabase.co/functions/v1/lji-whatsapp-webhook-v1',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='radar_lj_v2_collector_api_key' limit 1)
        ),
        body := '{"action":"process_queue"}'::jsonb,
        timeout_milliseconds := 120000
      );$job$
    );
  end if;
end $$;
