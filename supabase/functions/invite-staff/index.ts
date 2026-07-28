// Authenticated (verify_jwt=true), owner-only. Body: { org_id, email }.
// Lets a business owner add an employee to the same org so every staff member
// can log in on their own phone/tablet (own magic-link email) and use the
// scanner/dashboard — without ever sharing the owner's own login.
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

  const { org_id, email } = await req.json();
  if (!org_id || !email) {
    return Response.json({ error: 'org_id and email required' }, { status: 400, headers: corsHeaders });
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

  const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
  if (invited?.user) {
    staffUserId = invited.user.id;
  } else {
    // Most likely cause: this email already has an account — look them up
    // directly instead (auth.users isn't queryable via the normal client).
    const { data: existingId } = await supabaseAdmin.rpc('find_user_id_by_email', { p_email: email });
    if (!existingId) {
      return Response.json({ error: inviteError?.message ?? 'could not invite user' }, { status: 500, headers: corsHeaders });
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

  return Response.json({ ok: true }, { headers: corsHeaders });
});
