// Builds the ES256 JWT Apple's APNs requires for token-based authentication.
// Uses Deno's native WebCrypto — no PKCS7/CMS involved here (that's only needed for
// signing the .pkpass manifest itself, which is why that part lives in the Node
// pkpass-signer microservice instead of here).

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

let cachedToken: { token: string; expiresAt: number } | null = null;

// APNs auth keys are only ever a single reusable token per hour (Apple recommends
// caching, not minting a new one per push). teamId/keyId/privateKeyPem come from the
// .p8 key downloaded in docs/SETUP_ACCOUNTS.md step 2.
export async function getApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.token;
  }

  const teamId = Deno.env.get('APPLE_TEAM_ID')!;
  const keyId = Deno.env.get('APPLE_APNS_KEY_ID')!;
  const privateKeyPem = Deno.env.get('APPLE_APNS_PRIVATE_KEY')!; // PEM contents of the .p8 file

  const header = { alg: 'ES256', kid: keyId };
  const payload = { iss: teamId, iat: now };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );

  const token = `${signingInput}.${base64url(signature)}`;
  cachedToken = { token, expiresAt: now + 3000 }; // refresh every ~50min
  return token;
}
