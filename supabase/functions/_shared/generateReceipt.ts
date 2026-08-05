import { supabaseAdmin } from './supabaseAdmin.ts';
import { buildReceiptPdf } from './receiptPdf.ts';

// Called right after an invoice row is marked successful, from both
// cardcom-webhook (first/checkout payment) and billing-cron (recurring
// monthly charges) — every successful charge gets a receipt the same way.
// Deliberately swallows its own errors: a receipt-generation failure must
// never roll back or block a payment/subscription-activation that already
// succeeded. Logs loudly instead so it's visible in function logs.
export async function generateReceiptForInvoice(
  invoiceId: string,
  orgId: string,
  planTier: string,
  amountAgorot: number,
): Promise<void> {
  try {
    const { data: org } = await supabaseAdmin.from('orgs').select('name').eq('id', orgId).maybeSingle();

    const { data: receiptNumber, error: seqError } = await supabaseAdmin.rpc('next_receipt_number');
    if (seqError || typeof receiptNumber !== 'number') {
      throw new Error(`next_receipt_number failed: ${seqError?.message}`);
    }

    const pdfBytes = await buildReceiptPdf({
      receiptNumber,
      issuedAt: new Date(),
      payerOrgName: org?.name || 'לקוח',
      planTier,
      amountAgorot,
    });

    const path = `${orgId}/${invoiceId}.pdf`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from('receipts')
      .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw new Error(`receipt upload failed: ${uploadError.message}`);

    await supabaseAdmin
      .from('invoices')
      .update({ receipt_number: receiptNumber, receipt_storage_path: path })
      .eq('id', invoiceId);
  } catch (err) {
    console.error('generateReceiptForInvoice failed', invoiceId, err);
  }
}
