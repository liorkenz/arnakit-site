// Manual/debug trigger — normally Apple pushes are sent automatically by
// process-pass-update-queue. Useful to test APNs connectivity in isolation once
// the real cert/key are in place. Platform-admin only: takes an arbitrary
// customer_id, so without this check anyone with the public anon key could
// spam push notifications to any customer whose UUID they knew or guessed.
import { sendApplePushForCustomer } from '../_shared/applePush.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const adminId = await requireAdmin(req);
  if (!adminId) return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders });

  const { customer_id } = await req.json();
  if (!customer_id) {
    return Response.json({ error: 'customer_id required' }, { status: 400, headers: corsHeaders });
  }

  const results = await sendApplePushForCustomer(customer_id);
  return Response.json({ ok: true, results }, { headers: corsHeaders });
});
