// Authenticated + platform-admin only. Body: { org_id, card_id }.
// Deletes one loyalty card config row. Customers and their stamp/credit
// history are NOT touched — loyalty_cards isn't referenced by customers or
// stamp_events, so this only removes the card's own design/settings, never
// a customer's accumulated points.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { logSecurityEvent } from '../_shared/auditLog.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const adminId = await requireAdmin(req);
  if (!adminId) return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders });

  const { org_id, card_id } = await req.json();
  if (!org_id || !card_id) return Response.json({ error: 'org_id and card_id required' }, { status: 400, headers: corsHeaders });

  // Scoped to org_id too, not just card_id, so a mistyped/mismatched pair
  // can't delete a card belonging to a different org than the one shown.
  const { error, count } = await supabaseAdmin
    .from('loyalty_cards')
    .delete({ count: 'exact' })
    .eq('id', card_id)
    .eq('org_id', org_id);

  if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  if (!count) return Response.json({ error: 'card not found for this org' }, { status: 404, headers: corsHeaders });

  await logSecurityEvent({
    eventType: 'admin_card_deleted',
    actorUserId: adminId,
    orgId: org_id,
    detail: { card_id },
  });

  return Response.json({ ok: true }, { headers: corsHeaders });
});
