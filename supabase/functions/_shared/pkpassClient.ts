// Calls the internal Node microservice (services/pkpass-signer) that does the actual
// .pkpass manifest hashing + PKCS#7 signing + zip packaging — see the plan's rationale
// for why that part isn't done in Deno.

export interface PassCardRow {
  org_id: string;
  name: string;
  reward_type: 'stamps' | 'credit';
  target_count: number | null;
  reward_description: string | null;
  color_c1: string;
  color_c2: string;
  apple_pass_type_id: string | null;
  last_campaign_message: string | null;
  background_image_url: string | null;
}

export interface PassCustomerRow {
  pass_serial_number: string;
  pass_auth_token: string;
  stamps_count: number;
  credit_balance_agorot: number;
}

export async function generatePkpass(
  businessName: string,
  card: PassCardRow,
  customer: PassCustomerRow,
): Promise<Uint8Array> {
  const signerUrl = Deno.env.get('PKPASS_SIGNER_URL')!;
  const secret = Deno.env.get('PKPASS_SIGNER_SECRET')!;
  const functionsBase = Deno.env.get('SUPABASE_URL')!.replace('.supabase.co', '.functions.supabase.co');

  const res = await fetch(`${signerUrl}/generate-pass`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': secret,
    },
    body: JSON.stringify({
      businessName,
      rewardDescription: card.reward_description ?? '',
      rewardType: card.reward_type,
      targetCount: card.target_count,
      stampsCount: customer.stamps_count,
      creditBalanceAgorot: customer.credit_balance_agorot,
      colorC1: card.color_c1,
      colorC2: card.color_c2,
      passTypeId: card.apple_pass_type_id,
      backgroundImageUrl: card.background_image_url,
      webServiceUrl: `${functionsBase}/apple-passkit-web-service`,
      serialNumber: customer.pass_serial_number,
      authToken: customer.pass_auth_token,
      campaignMessage: card.last_campaign_message,
      unsubscribeUrl: `${functionsBase}/unsubscribe?serial=${customer.pass_serial_number}&token=${customer.pass_auth_token}`,
    }),
  });

  if (!res.ok) {
    throw new Error(`pkpass-signer failed: ${res.status} ${await res.text()}`);
  }

  return new Uint8Array(await res.arrayBuffer());
}
