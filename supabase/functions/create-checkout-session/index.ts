// Authenticated (verify_jwt=true, see supabase/config.toml). Starts a Cardcom hosted
// tokenization session for the caller's org. Body: { org_id, plan_tier }.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { createLowProfileSession } from '../_shared/cardcomClient.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

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

  // RLS-scoped check: this select only succeeds if the caller is actually a member.
  const { data: membership } = await userClient
    .from('org_members')
    .select('org_id')
    .eq('org_id', org_id)
    .maybeSingle();

  if (!membership) return Response.json({ error: 'not a member of this org' }, { status: 403, headers: corsHeaders });

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
    org_id,
    amountAgorot,
    `${origin}/?billing=success`,
    `${origin}/?billing=failed`,
  );

  await supabaseAdmin
    .from('subscriptions')
    .update({ plan_tier, price_agorot: amountAgorot })
    .eq('org_id', org_id);

  return Response.json({ redirectUrl: session.redirectUrl }, { headers: corsHeaders });
});
