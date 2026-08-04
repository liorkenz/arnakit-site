// Authenticated (verify_jwt=true), owner-only. Body: { request_id, decision }
// where decision is 'approved' or 'rejected'. Approving is the only path that
// actually sends anything — this is the single choke point that makes the
// whole approval workflow meaningful.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { executeCampaignSend, checkCampaignQuota } from '../_shared/campaignSend.ts';
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

  const { request_id, decision } = await req.json();
  if (!request_id || (decision !== 'approved' && decision !== 'rejected')) {
    return Response.json({ error: 'request_id and a valid decision required' }, { status: 400, headers: corsHeaders });
  }

  const { data: campaignRequest } = await supabaseAdmin
    .from('campaign_requests')
    .select('id, org_id, message, status')
    .eq('id', request_id)
    .maybeSingle();

  if (!campaignRequest) return Response.json({ error: 'not found' }, { status: 404, headers: corsHeaders });
  if (campaignRequest.status !== 'pending') {
    return Response.json({ error: 'this request was already decided' }, { status: 409, headers: corsHeaders });
  }

  // RLS-scoped: only succeeds if the caller is actually the owner of this org.
  const { data: membership } = await userClient
    .from('org_members')
    .select('role')
    .eq('org_id', campaignRequest.org_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membership?.role !== 'owner') {
    return Response.json({ error: 'only the owner can approve or reject a campaign' }, { status: 403, headers: corsHeaders });
  }

  if (decision === 'approved') {
    const quotaError = await checkCampaignQuota(campaignRequest.org_id);
    if (quotaError) return Response.json({ error: quotaError }, { status: 403, headers: corsHeaders });
    await executeCampaignSend(campaignRequest.org_id, campaignRequest.message, user.id);
  }

  await supabaseAdmin
    .from('campaign_requests')
    .update({ status: decision, decided_by: user.id, decided_at: new Date().toISOString() })
    .eq('id', request_id);

  return Response.json({ ok: true }, { headers: corsHeaders });
});
