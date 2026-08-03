// Authenticated (verify_jwt=true, see supabase/config.toml). Starts a Cardcom hosted
// tokenization session for the caller's org. Body: { org_id, plan_tier }.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { createLowProfileSession } from '../_shared/cardcomClient.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { logSecurityEvent } from '../_shared/auditLog.ts';

const FIXED_PRICES_AGOROT: Record<string, number> = {
  basic: 8900,
  featured: 23000,
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });

  const { org_id, plan_tier } = await req.json();

  // RLS-scoped, and explicitly role-checked: only the owner can change what the
  // whole org is billed for — mirrors the same fix applied to cancel-subscription.
  const { data: membership } = await userClient
    .from('org_members')
    .select('org_id, role')
    .eq('org_id', org_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membership?.role !== 'owner') {
    await logSecurityEvent({
      eventType: 'checkout_denied',
      actorUserId: user.id,
      actorEmail: user.email,
      orgId: org_id,
      detail: { reason: 'not_owner', plan_tier },
    });
    return Response.json({ error: 'only the owner can change the subscription plan' }, { status: 403, headers: corsHeaders });
  }

  let amountAgorot: number;
  if (plan_tier === 'chain') {
    // A platform-admin-negotiated fixed price always wins over the
    // auto-computed 5-billed/6th-free price, once one has been set.
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('custom_price_agorot')
      .eq('org_id', org_id)
      .maybeSingle();

    if (sub?.custom_price_agorot) {
      amountAgorot = sub.custom_price_agorot;
    } else {
      const { data: price, error } = await supabaseAdmin.rpc('fn_chain_price', { p_org_id: org_id });
      if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
      amountAgorot = price as number;
    }
  } else {
    amountAgorot = FIXED_PRICES_AGOROT[plan_tier];
    if (!amountAgorot) return Response.json({ error: 'invalid plan_tier' }, { status: 400, headers: corsHeaders });
  }

  const origin = Deno.env.get('DASHBOARD_ORIGIN')!;
  const session = await createLowProfileSession(
    { orgId: org_id, planTier: plan_tier },
    amountAgorot,
    `${origin}/?billing=success`,
    `${origin}/?billing=failed`,
  );

  // plan_tier is deliberately NOT written here — see cardcomClient.ts. It only
  // takes effect once cardcom-webhook confirms the charge actually succeeded,
  // otherwise a customer could "upgrade" for free by abandoning checkout.
  await logSecurityEvent({
    eventType: 'checkout_started',
    actorUserId: user.id,
    actorEmail: user.email,
    orgId: org_id,
    detail: { plan_tier, amount_agorot: amountAgorot },
  });

  return Response.json({ redirectUrl: session.redirectUrl }, { headers: corsHeaders });
});
