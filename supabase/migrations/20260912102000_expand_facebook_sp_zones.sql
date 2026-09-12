do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname = 'lji-facebook-operational-7x-day'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'lji-facebook-operational-9x-day',
    '0 0,3,6,10,13,16,18,20,22 * * *',
    $cmd$
      select net.http_post(
        url := 'https://aeuclswrxtqpcsexiobs.supabase.co/functions/v1/coletor-lj-v2',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='radar_lj_v2_collector_api_key' limit 1),
          'apikey',(select decrypted_secret from vault.decrypted_secrets where name='radar_lj_v2_collector_api_key' limit 1)
        ),
        body := jsonb_build_object(
          'action','collect',
          'source','facebook',
          'state_code','SP',
          'city',case extract(hour from timezone('UTC', now()))::integer
            when 0 then 'Santo André'
            when 3 then 'São Bernardo do Campo'
            when 6 then 'São Caetano do Sul'
            when 10 then 'Diadema'
            when 13 then 'São Paulo Centro Expandido'
            when 16 then 'São Paulo Zona Leste'
            when 18 then 'São Paulo Zona Sul'
            when 20 then 'São Paulo Zona Oeste'
            when 22 then 'São Paulo Zona Norte'
            else 'São Paulo'
          end,
          'transaction_type','sale',
          'property_type_code',null,
          'query_limit',1,
          'results_per_query',145
        ),
        timeout_milliseconds := 180000
      );
    $cmd$
  );
end $$;
