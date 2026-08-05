// Authenticated (verify_jwt=true). Body: { invoice_id }.
// Receipts live in a private storage bucket — this is the only path to
// actually read one, and it only ever hands back a short-lived signed URL
// (never a permanent public link) after confirming the caller either owns
// the invoice's org or is a platform admin. Prevents IDOR: guessing another
// org's invoice UUID gets a 403, not their financial document.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';

const SIGNED_URL_TTL_SECONDS = 300;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });

  const { invoice_id } = await req.json();
  if (!invoice_id) return Response.json({ error: 'invoice_id required' }, { status: 400, headers: corsHeaders });

  const { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select('org_id, receipt_storage_path')
    .eq('id', invoice_id)
    .maybeSingle();

  // Same generic "not found" whether the invoice doesn't exist or the caller
  // just isn't allowed to see it — don't confirm/deny existence either way.
  if (!invoice || !invoice.receipt_storage_path) {
    return Response.json({ error: 'not found' }, { status: 404, headers: corsHeaders });
  }

  const { data: membership } = await userClient
    .from('org_members')
    .select('org_id')
    .eq('org_id', invoice.org_id)
    .eq('user_id', user.id)
    .maybeSingle();

  const isAdmin = membership ? false : !!(await requireAdmin(req));
  if (!membership && !isAdmin) {
    return Response.json({ error: 'not found' }, { status: 404, headers: corsHeaders });
  }

  const { data: signed, error } = await supabaseAdmin.storage
    .from('receipts')
    .createSignedUrl(invoice.receipt_storage_path, SIGNED_URL_TTL_SECONDS);

  if (error || !signed) {
    return Response.json({ error: error?.message ?? 'could not sign url' }, { status: 500, headers: corsHeaders });
  }

  return Response.json({ url: signed.signedUrl }, { headers: corsHeaders });
});
