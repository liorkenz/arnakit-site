-- Minimal security audit trail: sensitive actions (admin access, staff
-- management, billing changes) and denied/failed attempts, so an intrusion or
-- abuse pattern is visible instead of invisible. Routine request/error logs
-- already exist natively (Supabase Dashboard → Auth Logs for sign-ins, →
-- Edge Functions → Logs for request/error traces) — this table is specifically
-- for the app-level "who did what to which org" trail those don't capture.
create table security_audit_log (
  id bigint generated always as identity primary key,
  event_type text not null,
  actor_user_id uuid,
  actor_email text,
  org_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index idx_security_audit_log_created_at on security_audit_log(created_at desc);
create index idx_security_audit_log_org on security_audit_log(org_id);

alter table security_audit_log enable row level security;

-- Only platform admins can read it; nothing can write to it directly (only
-- service_role, which bypasses RLS, and the SECURITY DEFINER trigger below).
create policy security_audit_log_select_admin on security_audit_log
  for select using (exists (select 1 from platform_admins where user_id = auth.uid()));

-- Covers staff/manager removal done straight from the dashboard (an
-- authenticated, RLS-scoped DELETE — not a service_role Edge Function call),
-- which is why this needs SECURITY DEFINER to write into the locked-down log
-- table above regardless of who performed the delete.
create or replace function fn_log_org_member_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into security_audit_log (event_type, actor_user_id, org_id, detail)
  values (
    'org_member_removed',
    auth.uid(),
    old.org_id,
    jsonb_build_object('removed_user_id', old.user_id, 'removed_email', old.email, 'removed_role', old.role, 'business_id', old.business_id)
  );
  return old;
end;
$$;

create trigger trg_log_org_member_removed
  after delete on org_members
  for each row execute function fn_log_org_member_removed();
