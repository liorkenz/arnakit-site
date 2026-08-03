import { logSecurityEvent } from './auditLog.ts';

// Gate for cron-only functions (billing-cron, process-pass-update-queue): Supabase's
// verify_jwt=true only checks that SOME validly-signed Supabase JWT was presented —
// the public anon key (embedded in index.html, meant to be public) IS such a JWT, so
// verify_jwt alone does NOT restrict these to pg_cron. This checks a custom secret
// instead, the same pattern already used for the pkpass-signer microservice.
// A failed attempt here means someone is hitting an internal-only endpoint without
// the secret — worth a log entry, since a real cron/pg_net call never fails this.
export async function requireInternalSecret(req: Request): Promise<boolean> {
  const provided = req.headers.get('x-internal-secret');
  const expected = Deno.env.get('INTERNAL_CRON_SECRET');
  const ok = !!expected && provided === expected;
  if (!ok) {
    await logSecurityEvent({ eventType: 'internal_secret_denied', detail: { path: new URL(req.url).pathname } });
  }
  return ok;
}
