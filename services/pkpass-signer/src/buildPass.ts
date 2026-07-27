import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PKPass } from 'passkit-generator';

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
}

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
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
