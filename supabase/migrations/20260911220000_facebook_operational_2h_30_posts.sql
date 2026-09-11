-- Facebook operational cadence: 30 posts every 2 hours.
-- Replaces the initial 10-post / 4-hour pilot schedule.

select cron.unschedule('lji-facebook-operational-4h');

select cron.schedule(
  'lji-facebook-operational-2h',
  '0 */2 * * *',
  $$
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
      'results_per_query',30
    ),
    timeout_milliseconds := 120000
  );
  $$
);
