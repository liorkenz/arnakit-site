// Platform-admin only. Body: { org_id, price_agorot }.
// Lets an admin change an already-onboarded chain's negotiated fixed price at
// any time (e.g. a renegotiated deal) — billing-cron and create-checkout-session
// both prefer subscriptions.custom_price_agorot over the auto-computed price
// whenever it's set. Pass price_agorot: null to go back to the auto-computed price.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const adminId = await requireAdmin(req);
  if (!adminId) return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders });

  const { org_id, price_agorot } = await req.json();
  if (!org_id) return Response.json({ error: 'org_id required' }, { status: 400, headers: corsHeaders });
  if (price_agorot !== null && (!price_agorot || price_agorot <= 0)) {
    return Response.json({ error: 'price_agorot must be a positive number or null' }, { status: 400, headers: corsHeaders });
  }

  const { error } = await supabaseAdmin
    .from('subscriptions')
    .update({ custom_price_agorot: price_agorot })
    .eq('org_id', org_id);

  if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });

  return Response.json({ ok: true }, { headers: corsHeaders });
});
