import { supabaseAdmin } from './supabaseAdmin.ts';
import { createGreenInvoiceReceipt } from './greenInvoiceClient.ts';

// Lior's own inbox — always gets a copy of every receipt as a bookkeeping
// backup, in addition to whatever's on file in Green Invoice itself.
const ARNAKIT_BACKUP_EMAIL = 'anakit.app@gmail.com';

// Called right after an invoice row is marked successful, from both
// cardcom-webhook (first/checkout payment) and billing-cron (recurring
// monthly charges). Deliberately swallows its own errors — a receipt
// failure must never roll back or block a payment that already succeeded.
// Logs loudly instead so it's visible in function logs.
export async function issueReceiptForInvoice(orgId: string, planTier: string, amountAgorot: number): Promise<void> {
  try {
    const { data: org } = await supabaseAdmin.from('orgs').select('name').eq('id', orgId).maybeSingle();

    const { data: owner } = await supabaseAdmin
      .from('org_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('role', 'owner')
      .maybeSingle();

    let ownerEmail: string | null = null;
    if (owner) {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(owner.user_id);
      ownerEmail = userData?.user?.email ?? null;
    }

    const emails = ownerEmail ? [ownerEmail, ARNAKIT_BACKUP_EMAIL] : [ARNAKIT_BACKUP_EMAIL];

    await createGreenInvoiceReceipt({
      clientName: org?.name || 'לקוח',
      clientEmails: emails,
      description: `תשלום מנוי Arnakit — תוכנית ${planTier}`,
      amountAgorot,
    });
  } catch (err) {
    console.error('issueReceiptForInvoice failed', orgId, err);
  }
}
