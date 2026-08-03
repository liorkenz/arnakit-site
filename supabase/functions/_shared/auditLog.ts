import { supabaseAdmin } from './supabaseAdmin.ts';

// Best-effort: a logging failure should never break the actual request.
export async function logSecurityEvent(event: {
  eventType: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  orgId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabaseAdmin.from('security_audit_log').insert({
      event_type: event.eventType,
      actor_user_id: event.actorUserId ?? null,
      actor_email: event.actorEmail ?? null,
      org_id: event.orgId ?? null,
      detail: event.detail ?? null,
    });
  } catch (err) {
    console.error('logSecurityEvent failed', err);
  }
}
