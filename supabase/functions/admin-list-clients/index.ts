// Authenticated + platform-admin only. Lists every org on the platform (Arnakit's
// "clients" — the chains/merchants, not their end customers) with plan/status,
// branch count, and total customer count, for the admin overview screen.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const adminId = await requireAdmin(req);
  if (!adminId) return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders });

  const { data: orgs, error } = await supabaseAdmin
    .from('orgs')
    .select('id, name, created_at')
    .order('created_at', { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  if (!orgs || orgs.length === 0) return Response.json({ clients: [] }, { headers: corsHeaders });

  const orgIds = orgs.map((o) => o.id);
  const { data: subs } = await supabaseAdmin
    .from('subscriptions')
    .select('org_id, plan_tier, status')
    .in('org_id', orgIds);
  const subsByOrg = new Map((subs ?? []).map((s) => [s.org_id, s]));

  const results = await Promise.all(
    orgs.map(async (org) => {
      const { count: branchCount } = await supabaseAdmin
        .from('businesses')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.id);

      const { count: customerCount } = await supabaseAdmin
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.id);

      const sub = subsByOrg.get(org.id);

      return {
        org_id: org.id,
        org_name: org.name,
        plan_tier: sub?.plan_tier ?? null,
        subscription_status: sub?.status ?? null,
        branch_count: branchCount ?? 0,
        total_customers: customerCount ?? 0,
        created_at: org.created_at,
      };
    }),
  );

  return Response.json({ clients: results }, { headers: corsHeaders });
});
