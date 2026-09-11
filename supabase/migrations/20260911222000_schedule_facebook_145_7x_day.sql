do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'lji-facebook-operational-2h' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  select jobid into v_jobid from cron.job where jobname = 'lji-facebook-operational-7x-day' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'lji-facebook-operational-7x-day',
    '0 0,3,6,10,13,17,20 * * *',
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
          'city','Santo André',
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
