// Authenticated (verify_jwt=true), owner-only. Body: { org_id, email, password }.
// The owner picks the password themselves and hands the email+password to the
// employee directly (in person / WhatsApp) — no invite email round-trip, so an
// employee with no email access on the shop tablet can still log in.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });

  const { org_id, email, password } = await req.json();
  if (!org_id || !email || !password) {
    return Response.json({ error: 'org_id, email and password required' }, { status: 400, headers: corsHeaders });
  }
  if (password.length < 6) {
    return Response.json({ error: 'password must be at least 6 characters' }, { status: 400, headers: corsHeaders });
  }

  // RLS-scoped: only succeeds if the caller is actually an owner of this org.
  const { data: membership } = await userClient
    .from('org_members')
    .select('role')
    .eq('org_id', org_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membership?.role !== 'owner') {
    return Response.json({ error: 'only the owner can invite staff' }, { status: 403, headers: corsHeaders });
  }

  let staffUserId: string | null = null;
  let passwordSet = false;

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (created?.user) {
    staffUserId = created.user.id;
    passwordSet = true;
  } else {
    // Most likely cause: this email already has an account somewhere else.
    // Deliberately do NOT let this owner overwrite that account's password —
    // that would let anyone hijack another org's login just by "inviting" its
    // email. Just look up the existing id and add them to this org's team.
    const { data: existingId } = await supabaseAdmin.rpc('find_user_id_by_email', { p_email: email });
    if (!existingId) {
      return Response.json({ error: createError?.message ?? 'could not create user' }, { status: 500, headers: corsHeaders });
    }
    staffUserId = existingId;
  }

  const { error: memberError } = await supabaseAdmin
    .from('org_members')
    .insert({ org_id, user_id: staffUserId, role: 'staff', email });

  if (memberError) {
    // unique violation = already a member of this org, treat as success
    if (memberError.code !== '23505') {
      return Response.json({ error: memberError.message }, { status: 500, headers: corsHeaders });
    }
  }

  return Response.json({ ok: true, password_set: passwordSet }, { headers: corsHeaders });
});
