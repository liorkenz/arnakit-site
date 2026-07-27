// Public (verify_jwt=false). Replaces the marketing page's fake client-only handler.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const { email } = await req.json().catch(() => ({}));
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return Response.json({ error: 'invalid email' }, { status: 400, headers: corsHeaders });
  }

  const { error } = await supabaseAdmin.from('waitlist').insert({ email: email.trim().toLowerCase() });

  // duplicate email = already on the list, treat as success rather than an error
  if (error && error.code !== '23505') {
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }

  return Response.json({ ok: true }, { headers: corsHeaders });
});
