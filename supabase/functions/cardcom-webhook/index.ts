// Public (verify_jwt=false — Cardcom can't send a Supabase JWT). Cardcom calls this
// after the customer finishes entering their card on the hosted LowProfile page.
// Idempotency: billing_webhook_log has a unique index on (provider, external_id), so
// a duplicate webhook delivery (Cardcom retries on non-2xx) is a no-op the second time.
import { supabaseAdmin, reactivateCardsForOrg } from '../_shared/supabaseAdmin.ts';
import { getLowProfileResult } from '../_shared/cardcomClient.ts';
import { issueReceiptForInvoice } from '../_shared/issueReceipt.ts';

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const lowProfileId = body.LowProfileId ?? body.lowProfileId;

  if (!lowProfileId) {
    return Response.json({ error: 'missing LowProfileId' }, { status: 400 });
  }

  const { error: logError } = await supabaseAdmin.from('billing_webhook_log').insert({
    provider: 'cardcom',
    event_type: 'low_profile_result',
    external_id: lowProfileId,
    payload: body,
  });

  if (logError) {
    // unique violation = we've already processed this LowProfileId
    if (logError.code === '23505') return Response.json({ ok: true, duplicate: true });
    console.error('failed to log webhook', logError);
  }

  const result = await getLowProfileResult(lowProfileId);

  if (!result.success || !result.orgId) {
    console.error('cardcom charge failed or missing orgId', result);
    return Response.json({ ok: true, chargeSuccess: false });
  }

  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('id, price_agorot, plan_tier')
    .eq('org_id', result.orgId)
    .maybeSingle();

  if (!subscription) {
    console.error('no subscription row for org', result.orgId);
    return Response.json({ ok: true, chargeSuccess: false });
  }

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  // plan_tier only changes here, on a confirmed successful charge — this is the
  // one place that's allowed to upgrade/downgrade what the org is billed for.
  await supabaseAdmin
    .from('subscriptions')
    .update({
      status: 'active',
      plan_tier: result.planTier ?? subscription.plan_tier,
      price_agorot: result.amountAgorot || subscription.price_agorot,
      provider_token_id: result.tokenId,
      current_period_start: periodStart.toISOString(),
      current_period_end: periodEnd.toISOString(),
      failed_attempts: 0,
    })
    .eq('id', subscription.id);

  const amountAgorot = result.amountAgorot || subscription.price_agorot;
  await supabaseAdmin.from('invoices').insert({
    subscription_id: subscription.id,
    org_id: result.orgId,
    provider_charge_id: result.transactionId,
    amount_agorot: amountAgorot,
    status: 'success',
  });

  await issueReceiptForInvoice(result.orgId, result.planTier ?? subscription.plan_tier, amountAgorot);

  // covers re-subscribing after a cancellation, where the org's cards were deactivated
  await reactivateCardsForOrg(result.orgId);

  return Response.json({ ok: true, chargeSuccess: true });
});
