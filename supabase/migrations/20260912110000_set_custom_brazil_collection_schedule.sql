do $$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid
    from cron.job
    where jobname in (
      'lji-facebook-operational-7x-day',
      'lji-facebook-operational-9x-day',
      'lji-facebook-operational-daily-7x',
      'lji-facebook-operational-today-20260912'
    )
  loop
    perform cron.unschedule(v_jobid);
  end loop;

  perform cron.schedule(
    'lji-facebook-operational-daily-7x',
    '0 1,4,7,10,13,17,21 * * *',
    $cmd$
      do $inner$
      declare
        v_local_date date := timezone('America/Sao_Paulo', now())::date;
        v_utc_hour integer := extract(hour from timezone('UTC', now()))::integer;
      begin
        if v_local_date < date '2026-09-13' then
          return;
        end if;

        perform net.http_post(
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
            'city',case v_utc_hour
              when 1 then 'São Paulo Zona Leste'
              when 4 then 'São Paulo Zona Oeste'
              when 7 then 'São Paulo Zona Sul'
              when 10 then 'São Caetano do Sul'
              when 13 then 'Santo André'
              when 17 then 'Diadema'
              when 21 then 'São Bernardo do Campo'
              else 'São Paulo'
            end,
            'transaction_type','sale',
            'property_type_code',null,
            'query_limit',1,
            'results_per_query',145
          ),
          timeout_milliseconds := 180000
        );
      end
      $inner$;
    $cmd$
  );

  perform cron.schedule(
    'lji-facebook-operational-today-20260912',
    '0 1,14,17,21 * * *',
    $cmd$
      do $inner$
      declare
        v_local_date date := timezone('America/Sao_Paulo', now())::date;
        v_utc_hour integer := extract(hour from timezone('UTC', now()))::integer;
      begin
        if v_local_date <> date '2026-09-12' then
          return;
        end if;

        perform net.http_post(
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
            'city',case v_utc_hour
              when 14 then 'São Caetano do Sul'
              when 17 then 'Santo André'
              when 21 then 'São Bernardo do Campo'
              when 1 then 'Diadema'
              else 'São Paulo'
            end,
            'transaction_type','sale',
            'property_type_code',null,
            'query_limit',1,
            'results_per_query',145
          ),
          timeout_milliseconds := 180000
        );
      end
      $inner$;
    $cmd$
  );
end $$;
