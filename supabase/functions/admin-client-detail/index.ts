// Authenticated + platform-admin only. Body: { org_id }.
// Returns a chain's branches and its shared card(s), each with how many
// customers hold it — cards are org-wide, so every branch shares the count.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const adminId = await requireAdmin(req);
  if (!adminId) return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders });

  const { org_id } = await req.json();
  if (!org_id) return Response.json({ error: 'org_id required' }, { status: 400, headers: corsHeaders });

  const { data: org } = await supabaseAdmin
    .from('orgs')
    .select('id, name, created_at')
    .eq('id', org_id)
    .maybeSingle();

  if (!org) return Response.json({ error: 'not found' }, { status: 404, headers: corsHeaders });

  const { data: branches } = await supabaseAdmin
    .from('businesses')
    .select('id, name, slug, created_at')
    .eq('org_id', org_id)
    .order('created_at', { ascending: true });

  const { data: cards } = await supabaseAdmin
    .from('loyalty_cards')
    .select('id, name, reward_type, target_count, is_active, created_at')
    .eq('org_id', org_id)
    .order('created_at', { ascending: true });

  const { count: totalCustomers } = await supabaseAdmin
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org_id);

  return Response.json(
    { org, branches: branches ?? [], cards: cards ?? [], total_customers: totalCustomers ?? 0 },
    { headers: corsHeaders },
  );
});
