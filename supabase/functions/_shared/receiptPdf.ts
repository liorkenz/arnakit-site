import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import { RUBIK_FONT_BASE64 } from './rubikFontData.ts';

// Embedded as base64 in a .ts module rather than read from a sibling file at
// runtime — Supabase's function bundler only tracks files reachable through
// static imports, so a plain Deno.readFile('./assets/Rubik.ttf') silently
// deployed without the font and failed with a 500 on every real invocation
// once tested live. Decoded once per function instance, reused after that.
let cachedFontBytes: Uint8Array | null = null;
function getRubikFontBytes(): Uint8Array {
  if (cachedFontBytes) return cachedFontBytes;
  const binary = atob(RUBIK_FONT_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  cachedFontBytes = bytes;
  return bytes;
}

// Simple heuristic reversal for short Hebrew label/value strings so they
// display right-to-left when drawn with pdf-lib (which always draws
// left-to-right, character by character, with no bidi algorithm of its
// own). Only reverses runs of Hebrew letters — leaves numbers, ₪, and Latin
// text (dates, amounts) in their normal reading order within the string.
function rtlFix(text: string): string {
  return text
    .split(/(\s+)/)
    .map((word) => (/[֐-׿]/.test(word) ? word.split('').reverse().join('') : word))
    .reverse()
    .join('');
}

export interface ReceiptData {
  receiptNumber: number;
  issuedAt: Date;
  payerOrgName: string;
  planTier: string;
  amountAgorot: number;
}

// base64-decoded rather than read as plain UTF-8 secrets — tested live and
// confirmed `supabase secrets set --env-file` corrupts specific non-ASCII
// bytes on Windows (a yod silently became two U+FFFD replacement chars, even
// though the source .env file was verified byte-correct). Storing as
// base64 keeps the secret itself pure ASCII, immune to that mangling.
function decodeB64Utf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Arnakit's own issuer details (an עוסק פטור — no VAT charged, so this is a
// plain קבלה/receipt, not a חשבונית מס). Read from secrets rather than
// hardcoded so they can be corrected without a code change if anything
// about the business registration changes.
export async function buildReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const businessNameB64 = Deno.env.get('ARNAKIT_BUSINESS_NAME_B64');
  const ownerNameB64 = Deno.env.get('ARNAKIT_OWNER_NAME_B64');
  const issuerName = businessNameB64 ? decodeB64Utf8(businessNameB64) : 'ארנקית';
  const issuerOwner = ownerNameB64 ? decodeB64Utf8(ownerNameB64) : '';
  const issuerTaxId = Deno.env.get('ARNAKIT_TAX_ID') || '';

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(getRubikFontBytes());

  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();
  const ink = rgb(0.07, 0.08, 0.11);
  const muted = rgb(0.4, 0.42, 0.47);
  const mint = rgb(0.29, 0.84, 0.77);

  const drawRTL = (text: string, x: number, y: number, size: number, color = ink) => {
    const fixed = rtlFix(text);
    const w = font.widthOfTextAtSize(fixed, size);
    page.drawText(fixed, { x: x - w, y, size, font, color });
  };

  let y = height - 70;
  drawRTL(issuerName, width - 50, y, 22, ink);
  y -= 22;
  drawRTL('קבלה', width - 50, y, 14, mint);
  y -= 40;

  drawRTL(`מספר קבלה: ${data.receiptNumber}`, width - 50, y, 11, muted);
  y -= 16;
  drawRTL(`תאריך: ${data.issuedAt.toLocaleDateString('he-IL')}`, width - 50, y, 11, muted);
  y -= 16;
  if (issuerOwner) {
    drawRTL(`עוסק פטור: ${issuerOwner}`, width - 50, y, 11, muted);
    y -= 16;
  }
  if (issuerTaxId) {
    drawRTL(`מספר עוסק: ${issuerTaxId}`, width - 50, y, 11, muted);
    y -= 16;
  }
  y -= 20;

  drawRTL('התקבל מאת:', width - 50, y, 11, muted);
  y -= 18;
  drawRTL(data.payerOrgName, width - 50, y, 14, ink);
  y -= 40;

  page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
  y -= 30;

  const amountShekel = (data.amountAgorot / 100).toFixed(2);
  drawRTL(`תשלום מנוי Arnakit — תוכנית ${data.planTier}`, width - 50, y, 12, ink);
  const amountLabel = `₪${amountShekel}`;
  const amountW = font.widthOfTextAtSize(amountLabel, 12);
  page.drawText(amountLabel, { x: 50, y, size: 12, font, color: ink });
  y -= 40;

  page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
  y -= 26;

  drawRTL(`סה"כ שולם: ₪${amountShekel}`, width - 50, y, 14, ink);
  y -= 40;

  drawRTL('עוסק פטור מתשלום מע"מ לפי סעיף 31(3) לחוק מס ערך מוסף.', width - 50, 60, 9, muted);

  return pdfDoc.save();
}
