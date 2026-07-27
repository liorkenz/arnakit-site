// Public (verify_jwt=false). Linked from the back of the wallet pass itself
// (see buildPass.ts's backFields) so a customer can opt out of promotional
// messages at any time without contacting the business — the easy-opt-out half
// of Amendment 40's opt-in + opt-out requirement.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const serial = url.searchParams.get('serial');
  const token = url.searchParams.get('token');

  if (!serial || !token) return new Response('missing parameters', { status: 400 });

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('id, pass_auth_token')
    .eq('pass_serial_number', serial)
    .maybeSingle();

  if (!customer || customer.pass_auth_token !== token) {
    return new Response('invalid link', { status: 401 });
  }

  await supabaseAdmin.from('customers').update({ marketing_consent: false }).eq('id', customer.id);

  return new Response(
    `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><title>הוסרתם בהצלחה</title></head>
<body style="font-family:sans-serif; text-align:center; padding:60px 20px;">
<h1>הוסרתם בהצלחה</h1>
<p>לא תקבלו יותר הודעות מבצעים מהעסק. הכרטיס עצמו וצבירת התווים ימשיכו לפעול כרגיל.</p>
</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
});
