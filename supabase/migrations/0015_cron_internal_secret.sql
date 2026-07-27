-- Security audit finding: verify_jwt=true only checks that SOME validly-signed
-- Supabase JWT is present — the public anon key (embedded in index.html) is
-- itself such a JWT, so it was never actually restricted to pg_cron. Re-point
-- both cron jobs at the internal-secret header instead (billing-cron and
-- process-pass-update-queue are now verify_jwt=false, see config.toml, and
-- check this header themselves).
--
-- IMPORTANT — run once in the Supabase SQL editor (not committed to git):
--   alter database postgres set app.settings.internal_cron_secret = '<same value as the INTERNAL_CRON_SECRET secret>';

select cron.unschedule('arnakit-billing-cron-daily');
select cron.unschedule('arnakit-process-pass-update-queue-minutely');

select cron.schedule(
  'arnakit-billing-cron-daily',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://swtdgghjpcvyhrdwggae.supabase.co/functions/v1/billing-cron',
    headers := jsonb_build_object(
      'x-internal-secret', current_setting('app.settings.internal_cron_secret', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'arnakit-process-pass-update-queue-minutely',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://swtdgghjpcvyhrdwggae.supabase.co/functions/v1/process-pass-update-queue',
    headers := jsonb_build_object(
      'x-internal-secret', current_setting('app.settings.internal_cron_secret', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
