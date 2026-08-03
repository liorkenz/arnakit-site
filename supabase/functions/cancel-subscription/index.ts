// Authenticated (verify_jwt=true). Called from the dashboard's billing tab.
// Cancels the org's subscription and deactivates its loyalty cards immediately —
// a canceled subscriber shouldn't keep getting the paid service for free. The
// dashboard itself already re-locks behind the paywall once status isn't 'active'
// (see main.js loadOrg), so this mainly stops *new* customers from being able to
// enroll via the QR link (enroll checks loyalty_cards.is_active).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { supabaseAdmin, deactivateCardsForOrg } from '../_shared/supabaseAdmin.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { logSecurityEvent } from '../_shared/auditLog.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });

  const { org_id } = await req.json();

  // RLS-scoped, and explicitly role-checked: any org member could see a row
  // here (not just the owner), so without the role check below any staff or
  // branch manager could cancel the whole org's subscription via this endpoint
  // even though the dashboard only shows the button to owners.
  const { data: membership } = await userClient
    .from('org_members')
    .select('org_id, role')
    .eq('org_id', org_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membership?.role !== 'owner') {
    await logSecurityEvent({
      eventType: 'subscription_cancel_denied',
      actorUserId: user.id,
      actorEmail: user.email,
      orgId: org_id,
      detail: { reason: 'not_owner' },
    });
    return Response.json({ error: 'only the owner can cancel the subscription' }, { status: 403, headers: corsHeaders });
  }

  await supabaseAdmin
    .from('subscriptions')
    .update({ status: 'canceled' })
    .eq('org_id', org_id);

  await deactivateCardsForOrg(org_id);

  await logSecurityEvent({
    eventType: 'subscription_cancelled',
    actorUserId: user.id,
    actorEmail: user.email,
    orgId: org_id,
  });

  return Response.json({ ok: true }, { headers: corsHeaders });
});
