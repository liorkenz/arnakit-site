// Public (verify_jwt=false). GET ?slug=:businessSlug — returns JSON only (never
// HTML: Supabase Edge Functions force GET responses with text/html Content-Type
// down to text/plain, so any user-facing page has to live on the actual website,
// not here). Used by join.html to show the right brand name before consenting.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  if (!slug) return Response.json({ error: 'missing slug' }, { status: 400, headers: corsHeaders });

  const { data: business } = await supabaseAdmin
    .from('businesses')
    .select('org_id')
    .eq('slug', slug)
    .maybeSingle();

  if (!business) return Response.json({ error: 'not found' }, { status: 404, headers: corsHeaders });

  const { data: org } = await supabaseAdmin
    .from('orgs')
    .select('name')
    .eq('id', business.org_id)
    .maybeSingle();

  const { data: card } = await supabaseAdmin
    .from('loyalty_cards')
    .select('id')
    .eq('org_id', business.org_id)
    .eq('is_active', true)
    .limit(1);

  return Response.json(
    { brandName: org?.name ?? slug, hasActiveCard: (card?.length ?? 0) > 0 },
    { headers: corsHeaders },
  );
});
