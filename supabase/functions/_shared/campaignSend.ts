import { supabaseAdmin } from './supabaseAdmin.ts';
import { sendApplePushForCustomer } from './applePush.ts';
import { sendGoogleWalletMessage } from './googleWallet.ts';

// Shared by send-campaign (owner, immediate) and respond-campaign-request
// (owner approving a staff/manager's request) — the actual "push this message
// to every opted-in customer" logic is identical either way, only how you're
// allowed to reach it differs.
export async function executeCampaignSend(orgId: string, message: string, createdBy: string): Promise<number> {
  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from('push_campaigns')
    .insert({ org_id: orgId, message, status: 'sending', created_by: createdBy })
    .select('id')
    .single();

  if (campaignError) throw new Error(campaignError.message);

  // Apple only shows a notification when the changeMessage field's value actually
  // changes, which is why the new text has to land in the DB before the push fires —
  // the device re-fetches the pass and sees this new value.
  await supabaseAdmin
    .from('loyalty_cards')
    .update({ last_campaign_message: message })
    .eq('org_id', orgId);

  // Only customers who opted in at enrollment (Amendment 40 requires opt-in for
  // advertising messages) — a plain stamp update isn't gated by this since it's
  // not promotional, but a campaign message like this one is. Every customer of
  // the org gets it, regardless of which branch they enrolled at.
  const { data: customers } = await supabaseAdmin
    .from('customers')
    .select('id, platform')
    .eq('org_id', orgId)
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

  return sentCount;
}

// Basic-plan quota check, shared the same way.
export async function checkCampaignQuota(orgId: string): Promise<string | null> {
  const MONTHLY_MESSAGE_LIMIT_BASIC = 4;
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('plan_tier, current_period_start')
    .eq('org_id', orgId)
    .maybeSingle();

  if (subscription?.plan_tier !== 'basic') return null;

  const periodStart = subscription.current_period_start
    ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { count } = await supabaseAdmin
    .from('push_campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'sent')
    .gte('sent_at', periodStart);

  if ((count ?? 0) >= MONTHLY_MESSAGE_LIMIT_BASIC) {
    return `הגעתם למכסת ${MONTHLY_MESSAGE_LIMIT_BASIC} ההודעות החודשיות של התוכנית הבסיסית. שדרגו לתוכנית המומלצת להודעות ללא הגבלה.`;
  }
  return null;
}
