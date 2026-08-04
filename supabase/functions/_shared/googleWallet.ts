import { supabaseAdmin } from './supabaseAdmin.ts';
import type { PassCardRow, PassCustomerRow } from './pkpassClient.ts';

// No `googleapis` npm package here on purpose (heavy, Node-oriented) — Google's own
// docs document raw-JWT construction as first-class supported, and Deno's native
// WebCrypto handles RS256 fine, same pattern as appleJwt.ts's ES256.

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  // Secrets set via shell/CLI tooling can end up with literal backslash-n
  // sequences instead of real newlines (multi-line env values are easy to mangle
  // passing through Bash -> a subprocess on Windows) — normalize either form.
  const normalized = pem.includes('\\n') && !pem.includes('\n') ? pem.replace(/\\n/g, '\n') : pem;
  const b64 = normalized.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function importServiceAccountKey(): Promise<CryptoKey> {
  const pem = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY')!;
  return crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function signRs256(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' }): Promise<string> {
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importServiceAccountKey();
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(signature)}`;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

// OAuth2 access token for calling the Wallet Objects REST API server-to-server
// (as opposed to the "Save to Wallet" JWT below, which the customer's phone consumes).
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60) {
    return cachedAccessToken.token;
  }

  const serviceAccountEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')!;
  const assertion = await signRs256({
    iss: serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) throw new Error(`Google OAuth token exchange failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  cachedAccessToken = { token: json.access_token, expiresAt: now + json.expires_in };
  return json.access_token;
}

function classId(orgId: string): string {
  const issuerId = Deno.env.get('GOOGLE_WALLET_ISSUER_ID')!;
  return `${issuerId}.arnakit_${orgId.replace(/-/g, '')}`;
}

function objectId(customerId: string): string {
  const issuerId = Deno.env.get('GOOGLE_WALLET_ISSUER_ID')!;
  return `${issuerId}.customer_${customerId.replace(/-/g, '')}`;
}

async function ensureLoyaltyClass(businessName: string, card: PassCardRow): Promise<string> {
  const issuerId = Deno.env.get('GOOGLE_WALLET_ISSUER_ID')!;
  const id = classId(card.org_id);
  const accessToken = await getAccessToken();

  const body: Record<string, unknown> = {
    id,
    issuerName: businessName,
    programName: card.name,
    programLogo: {
      sourceUri: { uri: 'https://placehold.co/200x200/1b3a3a/ffffff.png?text=%D7%90' },
    },
    hexBackgroundColor: card.color_c1,
    reviewStatus: 'UNDER_REVIEW',
  };

  // The merchant's uploaded background image (dashboard "תמונת רקע") — Google
  // Wallet's equivalent of Apple's strip image, shown as the card's banner.
  if (card.background_image_url) {
    body.heroImage = { sourceUri: { uri: card.background_image_url } };
  }

  const res = await fetch(
    `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${id}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );

  // Only 200 (exists) and 404 (doesn't exist) are expected outcomes here — any
  // other status (401/403/500/...) used to silently fall through to an unchecked
  // PUT that could no-op, leaving `classId` pointing at a class that was never
  // actually created on Google's side. That's the bug: the enroll request would
  // still "succeed" and hand back a signed save link referencing a nonexistent
  // class, which Google's own Save page then rejects with a generic error.
  if (res.status === 404) {
    const createRes = await fetch('https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!createRes.ok) throw new Error(`loyaltyClass create failed: ${createRes.status} ${await createRes.text()}`);
  } else if (res.status === 200) {
    const updateRes = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${id}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!updateRes.ok) throw new Error(`loyaltyClass update failed: ${updateRes.status} ${await updateRes.text()}`);
  } else {
    throw new Error(`loyaltyClass lookup failed: ${res.status} ${await res.text()}`);
  }

  return id;
}

function buildLoyaltyObject(classIdValue: string, objId: string, card: PassCardRow, customer: PassCustomerRow) {
  const balanceLabel = card.reward_type === 'stamps' ? 'תווים' : 'קרדיט';
  const balanceValue =
    card.reward_type === 'stamps'
      ? `${customer.stamps_count} / ${card.target_count ?? '-'}`
      : `₪${(customer.credit_balance_agorot / 100).toFixed(0)}`;

  return {
    id: objId,
    classId: classIdValue,
    state: 'ACTIVE',
    accountId: customer.pass_serial_number,
    loyaltyPoints: {
      label: balanceLabel,
      balance: { string: balanceValue },
    },
    barcode: { type: 'QR_CODE', value: customer.pass_serial_number },
    // Opt-out mechanism required alongside the opt-in consent collected at
    // enrollment (Amendment 40 to the Telecommunications Law).
    linksModuleData: {
      uris: [
        {
          uri: `${Deno.env.get('SUPABASE_URL')!.replace('.supabase.co', '.functions.supabase.co')}/unsubscribe?serial=${customer.pass_serial_number}&token=${customer.pass_auth_token}`,
          description: 'הסרה מהודעות מבצעים',
        },
      ],
    },
  };
}

// Called from `enroll` on first issuance — creates the class (once per business) and
// the object (once per customer), then returns the "Save to Google Wallet" URL.
export async function getGoogleSaveUrl(
  businessName: string,
  card: PassCardRow,
  customer: PassCustomerRow,
): Promise<string> {
  const classIdValue = await ensureLoyaltyClass(businessName, card);
  const objId = objectId((customer as unknown as { id: string }).id);
  const loyaltyObject = buildLoyaltyObject(classIdValue, objId, card, customer);

  await supabaseAdmin
    .from('customers')
    .update({ google_object_id: objId })
    .eq('pass_serial_number', customer.pass_serial_number);

  const serviceAccountEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')!;
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signRs256({
    iss: serviceAccountEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: now,
    origins: [Deno.env.get('ENROLL_PUBLIC_ORIGIN') ?? ''],
    payload: { loyaltyObjects: [loyaltyObject] },
  });

  return `https://pay.google.com/gp/v/save/${jwt}`;
}

// Sends a visible notification with real text — Google's equivalent of Apple's
// changeMessage mechanism. Unlike a plain PATCH (which silently updates the balance),
// this is what actually surfaces "כפול תווים עד 16:00" to the customer.
export async function sendGoogleWalletMessage(customerId: string, message: string): Promise<void> {
  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('google_object_id')
    .eq('id', customerId)
    .maybeSingle();

  if (!customer || !customer.google_object_id) return;

  const accessToken = await getAccessToken();
  await fetch(
    `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${customer.google_object_id}/addMessage`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { header: 'ארנקית', body: message, messageType: 'TEXT' },
      }),
    },
  );
}

// Called from process-pass-update-queue after a stamp is added — PATCHing the object
// auto-pushes the update to the customer's device, no separate push call needed
// (unlike Apple, which requires the silent-push-then-refetch dance).
export async function updateGoogleWalletObject(customerId: string): Promise<void> {
  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('id, google_object_id, org_id, stamps_count, credit_balance_agorot, pass_serial_number')
    .eq('id', customerId)
    .maybeSingle();

  if (!customer || !customer.google_object_id) return;

  const { data: card } = await supabaseAdmin
    .from('loyalty_cards')
    .select('*')
    .eq('org_id', customer.org_id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!card) return;

  const accessToken = await getAccessToken();
  const balanceLabel = card.reward_type === 'stamps' ? 'תווים' : 'קרדיט';
  const balanceValue =
    card.reward_type === 'stamps'
      ? `${customer.stamps_count} / ${card.target_count ?? '-'}`
      : `₪${(customer.credit_balance_agorot / 100).toFixed(0)}`;

  await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${customer.google_object_id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loyaltyPoints: { label: balanceLabel, balance: { string: balanceValue } },
    }),
  });
}
