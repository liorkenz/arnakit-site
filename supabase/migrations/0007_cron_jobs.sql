-- Schedules the two functions that must run without any human triggering them:
-- billing-cron (daily, charges whatever subscriptions are due) and
-- process-pass-update-queue (every minute, fans out live wallet updates after a stamp).
--
-- IMPORTANT: this migration references `current_setting('app.settings.service_role_key')`,
-- which is NOT set by this file on purpose — the service_role key must never be
-- committed to git. Before this migration's cron jobs can actually authenticate, run
-- once in the Supabase SQL editor (not in a migration file):
--   alter database postgres set app.settings.service_role_key = '<paste service_role key>';
-- (Both functions default to verify_jwt = true in supabase/config.toml, so the
-- Authorization header below is what lets pg_cron's calls through.)

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'arnakit-billing-cron-daily',
  '0 3 * * *', -- 03:00 UTC daily
  $$
  select net.http_post(
    url := 'https://swtdgghjpcvyhrdwggae.supabase.co/functions/v1/billing-cron',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
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
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
