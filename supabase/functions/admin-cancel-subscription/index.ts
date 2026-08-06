// Authenticated + platform-admin only. Body: { org_id }.
// Admin-side equivalent of the owner's own "cancel subscription" button —
// support scenario: a client asks Lior to cancel on their behalf. Same
// effect as cancel-subscription (status -> canceled, deactivate cards),
// just gated by requireAdmin instead of an owner-role check.
import { supabaseAdmin, deactivateCardsForOrg } from '../_shared/supabaseAdmin.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { logSecurityEvent } from '../_shared/auditLog.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const adminId = await requireAdmin(req);
  if (!adminId) return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders });

  const { org_id } = await req.json();
  if (!org_id) return Response.json({ error: 'org_id required' }, { status: 400, headers: corsHeaders });

  await supabaseAdmin.from('subscriptions').update({ status: 'canceled' }).eq('org_id', org_id);
  await deactivateCardsForOrg(org_id);

  await logSecurityEvent({
    eventType: 'admin_subscription_cancelled',
    actorUserId: adminId,
    orgId: org_id,
  });

  return Response.json({ ok: true }, { headers: corsHeaders });
});
