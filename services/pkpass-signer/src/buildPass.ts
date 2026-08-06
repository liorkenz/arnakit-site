import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PKPass } from 'passkit-generator';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = path.join(__dirname, '..', 'model.pass');

export interface CardData {
  businessName: string;
  rewardDescription: string;
  rewardType: 'stamps' | 'credit';
  targetCount: number | null;
  stampsCount: number;
  creditBalanceAgorot: number;
  colorC1: string;
  colorC2: string;
  passTypeId: string;
  webServiceUrl: string;
  serialNumber: string;
  authToken: string;
  campaignMessage: string | null;
  unsubscribeUrl: string;
  backgroundImageUrl: string | null;
}

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

// Apple always overlays the pass's primary/secondary fields (the stamp/credit
// count) directly on top of the strip image for storeCard passes — that's
// fixed by Apple's own pass rendering, not something pass.json can move. A
// merchant's photo can end up hard to read underneath the text, so darken it
// slightly before handing it to Apple, rather than leaving the raw photo as
// the text's background.
async function darkenForOverlayText(buffer: Buffer, opacity = 0.35): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 750;
  const height = metadata.height ?? 246;
  const veil = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: opacity } },
  })
    .png()
    .toBuffer();
  return sharp(buffer).resize(width, height).composite([{ input: veil, blend: 'over' }]).png().toBuffer();
}

// NOTE: this targets passkit-generator v3's PKPass.from(source, props) + field-bag API.
// Verify field/method names against the exact installed version once real certs exist
// and `npm install` has actually resolved a version — this was written without a live
// install to test against.
export async function buildPass(data: CardData): Promise<Buffer> {
  const certsDir = path.dirname(process.env.WWDR_PEM_PATH || './certs/wwdr.pem');
  if (!fs.existsSync(path.resolve(certsDir))) {
    throw new Error(
      `Certs directory not found at ${certsDir}. Add wwdr.pem, signerCert.pem, signerKey.pem ` +
      `per docs/SETUP_ACCOUNTS.md section 2 before generating real passes.`
    );
  }

  const pass = await PKPass.from(
    {
      model: MODEL_DIR,
      certificates: {
        wwdr: fs.readFileSync(process.env.WWDR_PEM_PATH!),
        signerCert: fs.readFileSync(process.env.SIGNER_CERT_PATH!),
        signerKey: fs.readFileSync(process.env.SIGNER_KEY_PATH!),
        signerKeyPassphrase: process.env.SIGNER_KEY_PASSPHRASE || undefined,
      },
    },
    {
      serialNumber: data.serialNumber,
      description: `${data.businessName} — כרטיס נאמנות`,
      organizationName: data.businessName,
      // organizationName alone isn't shown as visible text in the pass header —
      // logoText is what Wallet actually displays next to the logo image. Without
      // it, every business's card showed the same bundled generic logo.png with
      // no business name anywhere on the card face at all.
      logoText: data.businessName,
      passTypeIdentifier: data.passTypeId,
      teamIdentifier: process.env.APPLE_TEAM_ID!,
      webServiceURL: data.webServiceUrl,
      authenticationToken: data.authToken,
      backgroundColor: hexToRgb(data.colorC2),
      foregroundColor: 'rgb(246, 244, 239)',
      labelColor: 'rgb(154, 161, 178)',
    },
  );

  pass.type = 'storeCard';

  // storeCard's only real "photo" slot is the strip image at the top of the
  // card — the merchant's uploaded background image (dashboard "תמונת רקע")
  // is applied here. Reused as-is for both @1x/@2x since there's no
  // server-side resizing; Apple Wallet scales it to fit either way.
  if (data.backgroundImageUrl) {
    try {
      const imgRes = await fetch(data.backgroundImageUrl);
      if (imgRes.ok) {
        const rawBuffer = Buffer.from(await imgRes.arrayBuffer());
        const buffer = await darkenForOverlayText(rawBuffer);
        pass.addBuffer('strip.png', buffer);
        pass.addBuffer('strip@2x.png', buffer);
      } else {
        console.error('background image fetch failed', data.backgroundImageUrl, imgRes.status);
      }
    } catch (err) {
      console.error('background image fetch error', data.backgroundImageUrl, err);
    }
  }

  pass.primaryFields.push({
    key: 'balance',
    label: data.rewardType === 'stamps' ? 'תווים' : 'קרדיט',
    value:
      data.rewardType === 'stamps'
        ? `${data.stampsCount} / ${data.targetCount ?? '-'}`
        : `₪${(data.creditBalanceAgorot / 100).toFixed(0)}`,
  });

  pass.secondaryFields.push({
    key: 'reward',
    label: 'מבצע',
    value: data.rewardDescription,
  });

  // changeMessage is Apple's mechanism for a lock-screen notification: it only fires
  // when THIS field's value differs from the previously-installed pass, which is why
  // send-campaign writes a fresh value here before triggering the push.
  pass.backFields.push({
    key: 'campaignMessage',
    label: 'עדכון אחרון',
    value: data.campaignMessage ?? '',
    changeMessage: '%@',
  });

  // PassKit auto-links URLs found in back fields — this is the opt-out mechanism
  // required alongside the opt-in consent collected at enrollment (Amendment 40).
  pass.backFields.push({
    key: 'unsubscribe',
    label: 'לא רוצים לקבל הודעות מבצעים?',
    value: data.unsubscribeUrl,
  });

  pass.setBarcodes({
    message: data.serialNumber,
    format: 'PKBarcodeFormatQR',
    messageEncoding: 'iso-8859-1',
  });

  return pass.getAsBuffer();
}
