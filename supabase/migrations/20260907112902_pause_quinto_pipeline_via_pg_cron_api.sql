-- Pause QuintoAndar automatic verification until the Apify verifier is actually configured.
-- Use the pg_cron API instead of writing cron.job directly.
select cron.alter_job(6, active := false);
