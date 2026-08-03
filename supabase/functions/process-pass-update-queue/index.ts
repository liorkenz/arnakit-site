// Drains `pass_update_queue` (filled by the fn_queue_pass_update trigger on every
// stamp_events insert) and fans out live wallet updates: Apple gets a silent push
// telling the device to re-fetch; Google gets its object PATCHed directly (which
// Google auto-pushes to the device, no separate push step needed).
//
// Needs to run on a schedule — wire this up via `supabase functions deploy` +
// a pg_cron job calling this URL every ~30-60s (see supabase/migrations for a
// pg_cron + pg_net example once Phase 3's billing-cron pattern is in place, or
// use the Supabase dashboard's Edge Function schedule UI).
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { sendApplePushForCustomer } from '../_shared/applePush.ts';
import { updateGoogleWalletObject } from '../_shared/googleWallet.ts';
import { requireInternalSecret } from '../_shared/requireInternalSecret.ts';

Deno.serve(async (req) => {
  // verify_jwt=false for this function (see config.toml) — the public anon key
  // is itself a valid Supabase JWT, so JWT verification alone can't restrict
  // this to pg_cron. This secret is the only thing gating it.
  if (!(await requireInternalSecret(req))) {
    return new Response(null, { status: 401 });
  }

  const { data: queueItems, error } = await supabaseAdmin
    .from('pass_update_queue')
    .select('id, customer_id')
    .eq('processed', false)
    .limit(200);

  if (error) {
    console.error('failed to read pass_update_queue', error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!queueItems || queueItems.length === 0) {
    return Response.json({ processed: 0 });
  }

  // one push per distinct customer, even if several queue rows piled up
  const customerIds = [...new Set(queueItems.map((q) => q.customer_id))];

  await Promise.all(
    customerIds.map(async (customerId) => {
      const { data: customer } = await supabaseAdmin
        .from('customers')
        .select('platform')
        .eq('id', customerId)
        .maybeSingle();

      if (!customer) return;

      if (customer.platform === 'ios') {
        await sendApplePushForCustomer(customerId);
      } else if (customer.platform === 'android') {
        await updateGoogleWalletObject(customerId);
      }
    }),
  );

  const ids = queueItems.map((q) => q.id);
  await supabaseAdmin.from('pass_update_queue').update({ processed: true }).in('id', ids);

  return Response.json({ processed: queueItems.length, customers: customerIds.length });
});
