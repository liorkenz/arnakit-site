-- ALTER DATABASE ... SET requires superuser, which the Supabase SQL editor role
-- doesn't have on hosted projects (confirmed: permission denied, 42501). Supabase's
-- own recommended pattern for exactly this situation — making a secret available
-- to a pg_cron + pg_net job — is their Vault extension instead.
--
-- IMPORTANT — run once in the Supabase SQL editor (not committed to git):
--   select vault.create_secret('<same value as the INTERNAL_CRON_SECRET function secret>', 'internal_cron_secret');

select cron.unschedule('arnakit-billing-cron-daily');
select cron.unschedule('arnakit-process-pass-update-queue-minutely');

select cron.schedule(
  'arnakit-billing-cron-daily',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://swtdgghjpcvyhrdwggae.supabase.co/functions/v1/billing-cron',
    headers := jsonb_build_object(
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_cron_secret'),
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
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
