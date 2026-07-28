-- Used by the invite-staff Edge Function: when inviting an employee whose email
-- already has an account, auth.admin.inviteUserByEmail errors instead of
-- returning their id — this looks them up directly. auth.users isn't exposed via
-- PostgREST (only the public schema is), so this SECURITY DEFINER function is the
-- narrow, service_role-only bridge to it.
create or replace function find_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where email = p_email limit 1;
$$;

revoke execute on function find_user_id_by_email(text) from public;
revoke execute on function find_user_id_by_email(text) from anon;
revoke execute on function find_user_id_by_email(text) from authenticated;
grant execute on function find_user_id_by_email(text) to service_role;

-- The original policy only let a member see their own membership row — the new
-- "team" tab needs an owner to see every member of their org, not just themselves.
create policy org_members_select_team on org_members
  for select using (is_org_member_of(org_id));

-- Lets an owner remove a staff member directly from the client (RLS-scoped),
-- without needing a dedicated Edge Function just for this one action.
create or replace function is_org_owner_of(p_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from org_members om
    where om.org_id = p_org_id and om.user_id = auth.uid() and om.role = 'owner'
  );
$$;

revoke execute on function is_org_owner_of(uuid) from anon;
grant execute on function is_org_owner_of(uuid) to authenticated;

create policy org_members_delete_by_owner on org_members
  for delete using (role = 'staff' and is_org_owner_of(org_id));

-- org_members.email: denormalized purely for display in the "team" tab — auth.users
-- isn't exposed via PostgREST, so without this the dashboard would need an extra
-- admin-only Edge Function just to show who's on the team.
alter table org_members add column email text;

update org_members om set email = u.email from auth.users u where u.id = om.user_id;

create or replace function create_org_with_business(
  p_org_name text,
  p_business_name text,
  p_business_slug text,
  p_accepted_terms boolean default false
)
returns table(org_id uuid, business_id uuid)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_org_id uuid;
  v_business_id uuid;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not p_accepted_terms then
    raise exception 'must accept terms of service to create an organization';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into orgs (name, terms_accepted_at) values (p_org_name, now()) returning id into v_org_id;
  insert into org_members (org_id, user_id, role, email) values (v_org_id, auth.uid(), 'owner', v_email);
  insert into businesses (org_id, name, slug) values (v_org_id, p_business_name, p_business_slug)
    returning id into v_business_id;
  insert into loyalty_cards (org_id, name, reward_type, target_count, reward_description)
    values (v_org_id, p_business_name, 'stamps', 10, '10 = מתנה');
  insert into subscriptions (org_id, plan_tier, status, price_agorot)
    values (v_org_id, 'basic', 'trialing', 0);

  return query select v_org_id, v_business_id;
end;
$$;
