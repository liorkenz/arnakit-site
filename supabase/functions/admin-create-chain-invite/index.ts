// Platform-admin only. Body: { price_agorot, note? }.
// Creates a one-time onboarding link that locks a new org straight into
// plan_tier='chain' at this fixed price (negotiated by the admin outside the
// app), instead of the chain owner picking a plan and hitting the auto-computed
// per-branch price. Returns the link ready to paste/send.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const adminId = await requireAdmin(req);
  if (!adminId) return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders });

  const { price_agorot, note } = await req.json();
  if (!price_agorot || price_agorot <= 0) {
    return Response.json({ error: 'price_agorot must be a positive number' }, { status: 400, headers: corsHeaders });
  }

  const { data, error } = await supabaseAdmin
    .from('chain_invites')
    .insert({ price_agorot, note: note ?? null })
    .select('token')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });

  const origin = Deno.env.get('DASHBOARD_ORIGIN')!;
  return Response.json({ link: `${origin}/?chain_invite=${data.token}` }, { headers: corsHeaders });
});
