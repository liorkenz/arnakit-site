// Gate for cron-only functions (billing-cron, process-pass-update-queue): Supabase's
// verify_jwt=true only checks that SOME validly-signed Supabase JWT was presented —
// the public anon key (embedded in index.html, meant to be public) IS such a JWT, so
// verify_jwt alone does NOT restrict these to pg_cron. This checks a custom secret
// instead, the same pattern already used for the pkpass-signer microservice.
export function requireInternalSecret(req: Request): boolean {
  const provided = req.headers.get('x-internal-secret');
  const expected = Deno.env.get('INTERNAL_CRON_SECRET');
  return !!expected && provided === expected;
}
