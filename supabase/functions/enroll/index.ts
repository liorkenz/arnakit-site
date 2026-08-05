// Public entry point: GET /enroll?slug=:businessSlug — this is what the printed
// QR code points to, one per branch, but the card/customer it issues is scoped to
// the whole chain (org), so a customer's points work at every branch.
//
// IMPORTANT: Supabase Edge Functions silently rewrite any GET response whose
// Content-Type is text/html down to text/plain (an anti-abuse platform
// restriction on their shared domain — not something a function can override).
// So this function never returns an HTML body. The consent screen lives as a
// static page (join.html) on the actual marketing site instead:
//   1. No confirm=1 yet -> 302 redirect to join.html on the marketing site.
//   2. join.html shows the consent form (fetching the brand name from
//      enroll-info, a JSON-only sibling function) and detects iOS/Android
//      client-side, then submits back here with confirm=1&platform=...
//   3. This function then returns either the signed .pkpass binary (iOS) or a
//      302 redirect to the Google Wallet save URL (Android) — both non-HTML,
//      so the platform restriction doesn't apply.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { generatePkpass } from '../_shared/pkpassClient.ts';
import { getGoogleSaveUrl } from '../_shared/googleWallet.ts';

function detectPlatform(userAgent: string): 'ios' | 'android' | 'other' {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  if (!slug) return new Response('missing slug', { status: 400 });

  const marketingOrigin = Deno.env.get('ENROLL_PUBLIC_ORIGIN')!;

  if (url.searchParams.get('confirm') !== '1') {
    return Response.redirect(`${marketingOrigin}/join.html?slug=${encodeURIComponent(slug)}`, 302);
  }

  const { data: business } = await supabaseAdmin
    .from('businesses')
    .select('id, name, org_id')
    .eq('slug', slug)
    .maybeSingle();

  if (!business) return new Response('business not found', { status: 404 });

  const { data: org } = await supabaseAdmin
    .from('orgs')
    .select('name')
    .eq('id', business.org_id)
    .single();

  // A chain can have multiple active cards on the featured/chain plan, but a
  // branch's QR link isn't per-card — take the oldest (primary) active card.
  const { data: cardRows } = await supabaseAdmin
    .from('loyalty_cards')
    .select('*')
    .eq('org_id', business.org_id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1);

  const card = cardRows?.[0];
  if (!card) return new Response('this business has no active card', { status: 404 });

  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('plan_tier')
    .eq('org_id', business.org_id)
    .maybeSingle();

  if (subscription?.plan_tier === 'basic') {
    const { count } = await supabaseAdmin
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', business.org_id);
    if ((count ?? 0) >= 300) {
      return new Response('מועדון הלקוחות של העסק הזה מלא. פנו לעסק לפרטים.', { status: 403 });
    }
  }

  // join.html always sets this from navigator.userAgent client-side; the
  // server-side sniff is only a fallback for a direct/shared link.
  const platform = (url.searchParams.get('platform') as 'ios' | 'android' | null)
    ?? detectPlatform(req.headers.get('user-agent') || '');

  if (platform !== 'ios' && platform !== 'android') {
    return Response.redirect(`${marketingOrigin}/join.html?slug=${encodeURIComponent(slug)}`, 302);
  }

  const marketingConsent = url.searchParams.get('promo') === '1';
  const brandName = org?.name || business.name;
  const name = url.searchParams.get('name')?.trim() || null;
  const phone = url.searchParams.get('phone')?.trim() || null;

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .insert({
      org_id: business.org_id,
      enrolled_business_id: business.id,
      platform,
      marketing_consent: marketingConsent,
      consented_at: new Date().toISOString(),
      name,
      phone,
    })
    .select('*')
    .single();

  if (platform === 'ios') {
    const pkpass = await generatePkpass(brandName, card, customer);
    return new Response(pkpass, {
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="${slug}.pkpass"`,
      },
    });
  }

  const saveUrl = await getGoogleSaveUrl(brandName, card, customer);
  return Response.redirect(saveUrl, 302);
});
