import { supabaseAdmin } from './supabaseAdmin.ts';
import { getApnsJwt } from './appleJwt.ts';

// Sends a silent "pass content changed" push to every registered device for a
// customer. The device then calls GET /v1/passes/... (apple-passkit-web-service)
// to fetch the fresh pass — this function does not send the pass content itself,
// per Apple's PassKit push spec (payload is just `{}`).
export async function sendApplePushForCustomer(customerId: string): Promise<void> {
  const { data: devices } = await supabaseAdmin
    .from('apple_devices')
    .select('push_token, pass_type_identifier')
    .eq('customer_id', customerId);

  if (!devices || devices.length === 0) return;

  const jwt = await getApnsJwt();
  const teamId = Deno.env.get('APPLE_TEAM_ID')!;
  const useSandbox = Deno.env.get('APPLE_APNS_ENV') === 'sandbox';
  const apnsHost = useSandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';

  await Promise.all(
    devices.map((device) =>
      fetch(`https://${apnsHost}/3/device/${device.push_token}`, {
        method: 'POST',
        headers: {
          authorization: `bearer ${jwt}`,
          'apns-topic': device.pass_type_identifier,
          'apns-push-type': 'background',
          'apns-team-id': teamId,
        },
        body: JSON.stringify({}),
      }).catch((err) => console.error('APNs push failed', device.push_token, err)),
    ),
  );
}
