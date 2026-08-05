// Green Invoice API client — creates קבלה (plain receipt, no VAT) documents for
// Arnakit's own subscription payments. Arnakit is an עוסק פטור, so this only
// ever issues type 400 (קבלה), never a tax invoice.
//
// Payload shape (auth flow, required "payment" line with a non-future "date",
// vatType, etc.) was confirmed empirically against the real API — Green
// Invoice's docs are thin on field-level detail, so this was validated by
// creating one real test document (עוסק פטור account, confirmed vatRate: 0).
const GREEN_INVOICE_BASE = 'https://api.greeninvoice.co.il/api/v1';

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const res = await fetch(`${GREEN_INVOICE_BASE}/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: Deno.env.get('GREENINVOICE_API_KEY_ID'),
      secret: Deno.env.get('GREENINVOICE_API_KEY_SECRET'),
    }),
  });
  if (!res.ok) throw new Error(`Green Invoice auth failed: ${res.status} ${await res.text()}`);
  const json = await res.json();

  // Tokens are short-lived (~30 min per Green Invoice docs); refresh a bit
  // early rather than risk using one that just expired mid-request.
  cachedToken = { token: json.token, expiresAt: Date.now() + 25 * 60 * 1000 };
  return json.token;
}

export interface ReceiptInput {
  clientName: string;
  clientEmails: string[];
  description: string;
  amountAgorot: number;
}

export interface ReceiptResult {
  id: string;
  number: number;
  pdfUrl: string | null;
}

export async function createGreenInvoiceReceipt(input: ReceiptInput): Promise<ReceiptResult> {
  const token = await getAccessToken();
  const amountShekel = input.amountAgorot / 100;
  const todayIso = new Date().toISOString().slice(0, 10);

  const res = await fetch(`${GREEN_INVOICE_BASE}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      type: 400, // קבלה
      lang: 'he',
      currency: 'ILS',
      client: { name: input.clientName },
      income: [
        {
          description: input.description,
          quantity: 1,
          price: amountShekel,
          currency: 'ILS',
          vatType: 1, // exempt — matches the account's own עוסק פטור VAT setting (confirmed vatRate: 0 on test doc)
        },
      ],
      payment: [{ type: 3, price: amountShekel, currency: 'ILS', date: todayIso }], // type 3 = credit card, matches Cardcom
      emails: input.clientEmails,
    }),
  });

  if (!res.ok) throw new Error(`Green Invoice document create failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { id: json.id, number: json.number, pdfUrl: json.url?.he ?? json.url?.origin ?? null };
}
