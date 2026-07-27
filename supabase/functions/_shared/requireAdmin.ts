import { createClient } from 'npm:@supabase/supabase-js@2';
import { supabaseAdmin } from './supabaseAdmin.ts';

// Returns the caller's user id if they're a platform admin, or null otherwise.
// Used by every admin-* Edge Function — this is the only gate between a regular
// business-owner account and cross-org visibility into every client's data.
export async function requireAdmin(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return null;

  const { data: admin } = await supabaseAdmin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  return admin ? user.id : null;
}
