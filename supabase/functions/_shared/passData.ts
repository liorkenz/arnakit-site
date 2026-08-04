import { supabaseAdmin } from './supabaseAdmin.ts';
import type { PassCardRow, PassCustomerRow } from './pkpassClient.ts';

export interface FullPassData {
  businessName: string;
  card: PassCardRow;
  customer: PassCustomerRow & { id: string };
}

// Looks up everything needed to (re)generate a pass for a given serial number.
// Used by both `enroll` (first issuance) and `apple-passkit-web-service`
// (re-fetch after a stamp update). The card/brand is looked up by the
// customer's org (chain-wide), not by whichever branch they first scanned at.
export async function loadPassDataBySerial(serialNumber: string): Promise<FullPassData | null> {
  const { data: customer, error: customerErr } = await supabaseAdmin
    .from('customers')
    .select('id, org_id, pass_serial_number, pass_auth_token, stamps_count, credit_balance_agorot')
    .eq('pass_serial_number', serialNumber)
    .maybeSingle();

  if (customerErr || !customer) return null;

  const { data: org } = await supabaseAdmin
    .from('orgs')
    .select('name')
    .eq('id', customer.org_id)
    .maybeSingle();

  const { data: card } = await supabaseAdmin
    .from('loyalty_cards')
    .select('org_id, name, reward_type, target_count, reward_description, color_c1, color_c2, apple_pass_type_id, last_campaign_message, background_image_url')
    .eq('org_id', customer.org_id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!org || !card) return null;

  return { businessName: org.name, card, customer };
}
