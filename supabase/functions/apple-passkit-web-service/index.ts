// Single Apple PassKit web service, matching Apple's spec of one webServiceURL that
// all these routes hang off of:
//   POST   /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber
//   DELETE /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber
//   GET    /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier?passesUpdatedSince=...
//   GET    /v1/passes/:passTypeIdentifier/:serialNumber
//   POST   /v1/log
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { loadPassDataBySerial } from '../_shared/passData.ts';
import { generatePkpass } from '../_shared/pkpassClient.ts';

function extractAuthToken(req: Request): string | null {
  const header = req.headers.get('Authorization') || '';
  const match = header.match(/^ApplePass (.+)$/);
  return match ? match[1] : null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Supabase strips the function name; req path here is whatever comes after
  // .../apple-passkit-web-service
  const segments = url.pathname.split('/').filter(Boolean);

  try {
    // /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber?
    if (segments[0] === 'v1' && segments[1] === 'devices') {
      const deviceLibraryIdentifier = segments[2];
      const passTypeIdentifier = segments[4];
      const serialNumber = segments[5];

      if (req.method === 'POST' && serialNumber) {
        return await handleRegister(req, deviceLibraryIdentifier, passTypeIdentifier, serialNumber);
      }
      if (req.method === 'DELETE' && serialNumber) {
        return await handleUnregister(req, deviceLibraryIdentifier, passTypeIdentifier, serialNumber);
      }
      if (req.method === 'GET' && !serialNumber) {
        return await handleUpdatedSerials(deviceLibraryIdentifier, passTypeIdentifier, url);
      }
    }

    // /v1/passes/:passTypeIdentifier/:serialNumber
    if (segments[0] === 'v1' && segments[1] === 'passes' && req.method === 'GET') {
      return await handleGetPass(req, segments[3]);
    }

    // /v1/log
    if (segments[0] === 'v1' && segments[1] === 'log' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      console.log('[apple-passkit-log]', JSON.stringify(body));
      return new Response(null, { status: 200 });
    }

    return new Response('not found', { status: 404 });
  } catch (err) {
    console.error('apple-passkit-web-service error', err);
    return new Response('internal error', { status: 500 });
  }
});

async function handleRegister(
  req: Request,
  deviceLibraryIdentifier: string,
  passTypeIdentifier: string,
  serialNumber: string,
): Promise<Response> {
  const token = extractAuthToken(req);
  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('id, pass_auth_token')
    .eq('pass_serial_number', serialNumber)
    .maybeSingle();

  if (!customer || customer.pass_auth_token !== token) {
    return new Response(null, { status: 401 });
  }

  const { pushToken } = await req.json();

  const { data: existing } = await supabaseAdmin
    .from('apple_devices')
    .select('*')
    .eq('device_library_identifier', deviceLibraryIdentifier)
    .eq('pass_type_identifier', passTypeIdentifier)
    .eq('serial_number', serialNumber)
    .maybeSingle();

  await supabaseAdmin.from('apple_devices').upsert({
    device_library_identifier: deviceLibraryIdentifier,
    pass_type_identifier: passTypeIdentifier,
    serial_number: serialNumber,
    customer_id: customer.id,
    push_token: pushToken,
  });

  return new Response(null, { status: existing ? 200 : 201 });
}

async function handleUnregister(
  req: Request,
  deviceLibraryIdentifier: string,
  passTypeIdentifier: string,
  serialNumber: string,
): Promise<Response> {
  // Apple's spec requires the Authorization: ApplePass <token> header on this
  // route too — without this check, anyone who knows/guesses these three
  // identifiers could cut off another customer's live pass updates.
  const token = extractAuthToken(req);
  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('pass_auth_token')
    .eq('pass_serial_number', serialNumber)
    .maybeSingle();

  if (!customer || customer.pass_auth_token !== token) {
    return new Response(null, { status: 401 });
  }

  await supabaseAdmin
    .from('apple_devices')
    .delete()
    .eq('device_library_identifier', deviceLibraryIdentifier)
    .eq('pass_type_identifier', passTypeIdentifier)
    .eq('serial_number', serialNumber);

  return new Response(null, { status: 200 });
}

async function handleUpdatedSerials(
  deviceLibraryIdentifier: string,
  passTypeIdentifier: string,
  url: URL,
): Promise<Response> {
  const since = url.searchParams.get('passesUpdatedSince');

  const { data: devices } = await supabaseAdmin
    .from('apple_devices')
    .select('serial_number, customer_id')
    .eq('device_library_identifier', deviceLibraryIdentifier)
    .eq('pass_type_identifier', passTypeIdentifier);

  if (!devices || devices.length === 0) {
    return new Response(null, { status: 204 });
  }

  const customerIds = devices.map((d) => d.customer_id);
  let query = supabaseAdmin
    .from('customers')
    .select('id, pass_serial_number, last_visit_at')
    .in('id', customerIds);

  const { data: customers } = await query;

  const updatedSerials = (customers || [])
    .filter((c) => !since || !c.last_visit_at || new Date(c.last_visit_at) > new Date(since))
    .map((c) => c.pass_serial_number);

  if (updatedSerials.length === 0) {
    return new Response(null, { status: 204 });
  }

  return Response.json({
    serialNumbers: updatedSerials,
    lastUpdated: new Date().toISOString(),
  });
}

async function handleGetPass(req: Request, serialNumber: string): Promise<Response> {
  const token = extractAuthToken(req);
  const passData = await loadPassDataBySerial(serialNumber);

  if (!passData || passData.customer.pass_auth_token !== token) {
    return new Response(null, { status: 401 });
  }

  const pkpass = await generatePkpass(passData.businessName, passData.card, passData.customer);

  return new Response(pkpass, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Last-Modified': new Date().toUTCString(),
    },
  });
}
