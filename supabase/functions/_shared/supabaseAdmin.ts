import { createClient } from 'npm:@supabase/supabase-js@2';

// service_role client — full DB access, bypasses RLS. Only ever used inside Edge Functions,
// never shipped to any client bundle. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// auto-injected by the Supabase platform into every Edge Function's environment.
export const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Shared by billing-cron and cardcom-webhook: a lapsed/canceled subscription
// deactivates its org's cards (blocks new customer enrollment); a successful
// (re)charge reactivates them.
export async function deactivateCardsForOrg(orgId: string): Promise<void> {
  const { data: businesses } = await supabaseAdmin.from('businesses').select('id').eq('org_id', orgId);
  if (!businesses || businesses.length === 0) return;
  await supabaseAdmin.from('loyalty_cards').update({ is_active: false }).in('business_id', businesses.map((b) => b.id));
}

export async function reactivateCardsForOrg(orgId: string): Promise<void> {
  const { data: businesses } = await supabaseAdmin.from('businesses').select('id').eq('org_id', orgId);
  if (!businesses || businesses.length === 0) return;
  await supabaseAdmin.from('loyalty_cards').update({ is_active: true }).in('business_id', businesses.map((b) => b.id));
}
