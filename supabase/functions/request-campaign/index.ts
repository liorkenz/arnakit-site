// Authenticated (verify_jwt=true), any org member (owner included, though the
// dashboard routes owners through send-campaign directly). Body: { org_id, message }.
// Creates a pending campaign_requests row — nothing is sent to any customer
// until the owner approves it via respond-campaign-request.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });

  const { org_id, message } = await req.json();
  if (!org_id || !message) return Response.json({ error: 'org_id and message required' }, { status: 400, headers: corsHeaders });

  // RLS-scoped: only succeeds if the caller is actually a member of this org.
  const { data: membership } = await userClient
    .from('org_members')
    .select('org_id')
    .eq('org_id', org_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders });

  const { error } = await supabaseAdmin
    .from('campaign_requests')
    .insert({ org_id, message, requested_by: user.id, requested_by_email: user.email });

  if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });

  return Response.json({ ok: true }, { headers: corsHeaders });
});
