// Scheduled monthly (wire up via pg_cron + pg_net calling this URL daily — it only
// acts on subscriptions whose current_period_end has actually passed, so a daily
// tick is safe and simpler to reason about than trying to fire exactly once/month).
// This is what makes billing automatic: the merchant is charged from the token on
// file with zero manual action, which is the whole point — no chasing anyone for money.
import { supabaseAdmin, deactivateCardsForOrg, reactivateCardsForOrg } from '../_shared/supabaseAdmin.ts';
import { chargeByToken } from '../_shared/cardcomClient.ts';
import { requireInternalSecret } from '../_shared/requireInternalSecret.ts';

const MAX_FAILED_ATTEMPTS = 3;

Deno.serve(async (req) => {
  // verify_jwt=false for this function (see config.toml) — the public anon key
  // is itself a valid Supabase JWT, so JWT verification alone can't restrict
  // this to pg_cron. This secret is the only thing gating it.
  if (!(await requireInternalSecret(req))) {
    return new Response(null, { status: 401 });
  }

  const nowIso = new Date().toISOString();

  // Includes 'past_due' so a subscriber who fixes their card (or whose bank issue
  // resolves itself) keeps getting retried, not stuck forever after 3 failures.
  const { data: dueSubscriptions, error } = await supabaseAdmin
    .from('subscriptions')
    .select('id, org_id, plan_tier, provider_token_id, price_agorot, custom_price_agorot, failed_attempts')
    .in('status', ['active', 'past_due'])
    .lte('current_period_end', nowIso)
    .not('provider_token_id', 'is', null);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!dueSubscriptions || dueSubscriptions.length === 0) return Response.json({ charged: 0 });

  let charged = 0;
  let failed = 0;

  for (const sub of dueSubscriptions) {
    // chain-tier price is recomputed every cycle since branch count can change
    // month to month; basic/featured stay at their fixed price_agorot.
    let amountAgorot = sub.price_agorot;
    if (sub.plan_tier === 'chain') {
      // An admin-negotiated fixed price always wins over the auto-computed one.
      if (sub.custom_price_agorot) {
        amountAgorot = sub.custom_price_agorot;
      } else {
        const { data: price } = await supabaseAdmin.rpc('fn_chain_price', { p_org_id: sub.org_id });
        if (typeof price === 'number') amountAgorot = price;
      }
    }

    const result = await chargeByToken(sub.provider_token_id!, amountAgorot);

    if (result.success) {
      const periodStart = new Date();
      const periodEnd = new Date(periodStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      await supabaseAdmin
        .from('subscriptions')
        .update({
          status: 'active',
          price_agorot: amountAgorot,
          current_period_start: periodStart.toISOString(),
          current_period_end: periodEnd.toISOString(),
          failed_attempts: 0,
        })
        .eq('id', sub.id);

      await supabaseAdmin.from('invoices').insert({
        subscription_id: sub.id,
        org_id: sub.org_id,
        provider_charge_id: result.transactionId,
        amount_agorot: amountAgorot,
        status: 'success',
      });

      // in case this subscription had lapsed into past_due and had its cards
      // deactivated below on a previous run, a successful charge un-does that
      await reactivateCardsForOrg(sub.org_id);

      charged++;
    } else {
      const newFailedAttempts = sub.failed_attempts + 1;
      const nowPastDue = newFailedAttempts >= MAX_FAILED_ATTEMPTS;

      await supabaseAdmin
        .from('subscriptions')
        .update({
          status: nowPastDue ? 'past_due' : 'active',
          failed_attempts: newFailedAttempts,
        })
        .eq('id', sub.id);

      await supabaseAdmin.from('invoices').insert({
        subscription_id: sub.id,
        org_id: sub.org_id,
        amount_agorot: amountAgorot,
        status: 'failed',
      });

      // a subscriber who's stopped paying shouldn't keep getting the paid
      // service — new customers can no longer enroll via this business's QR
      // once its cards are deactivated (existing dashboard access is already
      // blocked separately by the paywall check on subscription.status).
      if (nowPastDue) await deactivateCardsForOrg(sub.org_id);

      failed++;
    }
  }

  return Response.json({ charged, failed, total: dueSubscriptions.length });
});
