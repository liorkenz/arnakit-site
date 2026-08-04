import { supabaseAdmin } from './supabaseAdmin.ts';
import { getApnsJwt } from './appleJwt.ts';

export interface ApnsPushResult {
  pushToken: string;
  ok: boolean;
  status?: number;
  apnsId?: string | null;
  error?: string;
}

// Sends a silent "pass content changed" push to every registered device for a
// customer. The device then calls GET /v1/passes/... (apple-passkit-web-service)
// to fetch the fresh pass — this function does not send the pass content itself,
// per Apple's PassKit push spec (payload is just `{}`).
//
// Returns per-device results instead of firing-and-forgetting: APNs responds
// 200 with an empty body on success, but a failure (bad token, wrong topic,
// bad auth) comes back as a 4xx with a JSON `{reason: "..."}` body — silently
// discarding that meant a broken push looked identical to a working one.
export async function sendApplePushForCustomer(customerId: string): Promise<ApnsPushResult[]> {
  const { data: devices } = await supabaseAdmin
    .from('apple_devices')
    .select('push_token, pass_type_identifier')
    .eq('customer_id', customerId);

  if (!devices || devices.length === 0) return [];

  const jwt = await getApnsJwt();
  const teamId = Deno.env.get('APPLE_TEAM_ID')!;
  const useSandbox = Deno.env.get('APPLE_APNS_ENV') === 'sandbox';
  const apnsHost = useSandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';

  return Promise.all(
    devices.map(async (device): Promise<ApnsPushResult> => {
      try {
        const res = await fetch(`https://${apnsHost}/3/device/${device.push_token}`, {
          method: 'POST',
          headers: {
            authorization: `bearer ${jwt}`,
            'apns-topic': device.pass_type_identifier,
            'apns-push-type': 'background',
            'apns-team-id': teamId,
          },
          body: JSON.stringify({}),
        });

        if (res.ok) {
          return { pushToken: device.push_token, ok: true, status: res.status, apnsId: res.headers.get('apns-id') };
        }

        const bodyText = await res.text().catch(() => '');
        console.error('APNs push rejected', device.push_token, res.status, bodyText);
        return { pushToken: device.push_token, ok: false, status: res.status, error: bodyText };
      } catch (err) {
        console.error('APNs push failed', device.push_token, err);
        return { pushToken: device.push_token, ok: false, error: (err as Error).message };
      }
    }),
  );
}
