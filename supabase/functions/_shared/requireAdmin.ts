import { createClient } from 'npm:@supabase/supabase-js@2';
import { supabaseAdmin } from './supabaseAdmin.ts';
import { logSecurityEvent } from './auditLog.ts';

// Returns the caller's user id if they're a platform admin, or null otherwise.
// Used by every admin-* Edge Function — this is the only gate between a regular
// business-owner account and cross-org visibility into every client's data.
// Every call (granted or denied) is logged: this is the single choke point for
// all cross-org admin access, so it's the cheapest place to get full coverage.
export async function requireAdmin(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    await logSecurityEvent({ eventType: 'admin_access_denied', detail: { reason: 'unauthenticated' } });
    return null;
  }

  const { data: admin } = await supabaseAdmin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  await logSecurityEvent({
    eventType: admin ? 'admin_access_granted' : 'admin_access_denied',
    actorUserId: user.id,
    actorEmail: user.email,
    detail: { reason: admin ? undefined : 'not_platform_admin' },
  });

  return admin ? user.id : null;
}
