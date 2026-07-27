// Authenticated (verify_jwt=true). Called from the dashboard's campaign composer.
// Body: { org_id, message }. Fans out a push to every customer of the org (every
// branch of the chain shares the same customer pool) — reuses the exact same
// Apple/Google plumbing as regular stamp updates, since from the wallet's
// perspective a campaign push and a stamp-triggered push are the same thing
// (a signal to re-fetch the pass; the *message* itself rides as the pass's
// relevantText / notification, not a separate channel).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { sendApplePushForCustomer } from '../_shared/applePush.ts';
import { sendGoogleWalletMessage } from '../_shared/googleWallet.ts';
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

  // RLS-scoped: only succeeds if the caller is actually a member of this org.
  const { data: membership } = await userClient
    .from('org_members')
    .select('org_id')
    .eq('org_id', org_id)
    .maybeSingle();

  if (!membership) return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders });

  const MONTHLY_MESSAGE_LIMIT_BASIC = 4;
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('plan_tier, current_period_start')
    .eq('org_id', org_id)
    .maybeSingle();

  if (subscription?.plan_tier === 'basic') {
    const periodStart = subscription.current_period_start
      ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { count } = await supabaseAdmin
      .from('push_campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org_id)
      .eq('status', 'sent')
      .gte('sent_at', periodStart);

    if ((count ?? 0) >= MONTHLY_MESSAGE_LIMIT_BASIC) {
      return Response.json(
        { error: `הגעתם למכסת ${MONTHLY_MESSAGE_LIMIT_BASIC} ההודעות החודשיות של התוכנית הבסיסית. שדרגו לתוכנית המומלצת להודעות ללא הגבלה.` },
        { status: 403, headers: corsHeaders },
      );
    }
  }

  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from('push_campaigns')
    .insert({ org_id, message, status: 'sending', created_by: user.id })
    .select('id')
    .single();

  if (campaignError) return Response.json({ error: campaignError.message }, { status: 500, headers: corsHeaders });

  // Apple only shows a notification when the changeMessage field's value actually
  // changes, which is why the new text has to land in the DB before the push fires —
  // the device re-fetches the pass and sees this new value.
  await supabaseAdmin
    .from('loyalty_cards')
    .update({ last_campaign_message: message })
    .eq('org_id', org_id);

  // Only customers who opted in at enrollment (Amendment 40 requires opt-in for
  // advertising messages) — a plain stamp update isn't gated by this since it's
  // not promotional, but a campaign message like this one is. Every customer of
  // the org gets it, regardless of which branch they enrolled at.
  const { data: customers } = await supabaseAdmin
    .from('customers')
    .select('id, platform')
    .eq('org_id', org_id)
    .eq('marketing_consent', true);

  let sentCount = 0;
  if (customers && customers.length > 0) {
    await Promise.all(
      customers.map(async (c) => {
        if (c.platform === 'ios') await sendApplePushForCustomer(c.id);
        else if (c.platform === 'android') await sendGoogleWalletMessage(c.id, message);
        sentCount++;
      }),
    );
  }

  await supabaseAdmin
    .from('push_campaigns')
    .update({ status: 'sent', sent_count: sentCount, sent_at: new Date().toISOString() })
    .eq('id', campaign.id);

  return Response.json({ ok: true, sentCount }, { headers: corsHeaders });
});
