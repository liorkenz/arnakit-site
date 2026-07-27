// Cardcom API v11 client — LowProfile hosted-tokenization flow + token-based recurring
// charges. Written against Cardcom's publicly documented LowProfile/Transactions API
// shape; exact field names should be double-checked against the live dashboard docs
// once real sandbox credentials exist (docs/SETUP_ACCOUNTS.md section 4) — this has
// not been exercised against a real Cardcom account yet.

const CARDCOM_BASE = 'https://secure.cardcom.solutions/api/v11';

function terminalCreds() {
  return {
    TerminalNumber: Number(Deno.env.get('CARDCOM_TERMINAL_NUMBER')),
    ApiName: Deno.env.get('CARDCOM_API_NAME')!,
  };
}

export interface LowProfileSession {
  lowProfileId: string;
  redirectUrl: string;
}

// Starts a hosted-tokenization session: the org owner is redirected to Cardcom's
// page to enter their card, which never touches our servers. `orgId` is passed
// through as ReturnValue so the webhook can correlate the result back to an org
// without needing a separate pending-checkout table.
export async function createLowProfileSession(
  orgId: string,
  amountAgorot: number,
  successUrl: string,
  failUrl: string,
): Promise<LowProfileSession> {
  const res = await fetch(`${CARDCOM_BASE}/LowProfile/Create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...terminalCreds(),
      Operation: 'ChargeAndCreateToken',
      Amount: amountAgorot / 100,
      ReturnValue: orgId,
      SuccessRedirectUrl: successUrl,
      FailedRedirectUrl: failUrl,
      WebHookUrl: Deno.env.get('CARDCOM_WEBHOOK_URL')!,
      Document: { DocumentType: 'Order' },
    }),
  });

  if (!res.ok) throw new Error(`Cardcom LowProfile/Create failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { lowProfileId: json.LowProfileId, redirectUrl: json.Url };
}

export interface LowProfileResult {
  success: boolean;
  orgId: string;
  tokenId: string | null;
  customerId: string | null;
  amountAgorot: number;
  transactionId: string | null;
}

export async function getLowProfileResult(lowProfileId: string): Promise<LowProfileResult> {
  const res = await fetch(`${CARDCOM_BASE}/LowProfile/Result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...terminalCreds(), LowProfileId: lowProfileId }),
  });

  if (!res.ok) throw new Error(`Cardcom LowProfile/Result failed: ${res.status} ${await res.text()}`);
  const json = await res.json();

  return {
    success: json.ResponseCode === 0,
    orgId: json.ReturnValue,
    tokenId: json.TranzactionInfo?.Token ?? null,
    customerId: json.UIValues?.CardOwnerEmail ?? null,
    amountAgorot: Math.round((json.TranzactionInfo?.Amount ?? 0) * 100),
    transactionId: json.TranzactionInfo?.TranzactionId ?? null,
  };
}

export interface ChargeResult {
  success: boolean;
  transactionId: string | null;
  errorMessage: string | null;
}

// Monthly recurring charge against a previously-issued token — called by billing-cron.
export async function chargeByToken(tokenId: string, amountAgorot: number): Promise<ChargeResult> {
  const res = await fetch(`${CARDCOM_BASE}/Transactions/Transaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...terminalCreds(),
      TokenToCharge: { Token: tokenId, Amount: amountAgorot / 100 },
    }),
  });

  if (!res.ok) {
    return { success: false, transactionId: null, errorMessage: `HTTP ${res.status}` };
  }

  const json = await res.json();
  return {
    success: json.ResponseCode === 0,
    transactionId: json.TranzactionId ?? null,
    errorMessage: json.ResponseCode === 0 ? null : json.Description ?? 'unknown error',
  };
}
