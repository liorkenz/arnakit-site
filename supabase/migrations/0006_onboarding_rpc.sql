-- Atomic onboarding: a brand-new authenticated user has no org yet, and there's no
-- direct insert policy on `orgs` (anyone inserting arbitrary orgs would be messy to
-- reason about). Instead, this SECURITY DEFINER function creates the org, makes the
-- calling user its owner, creates their first business, and starts a trialing
-- subscription — all atomically, all scoped to auth.uid() so a user can only ever
-- create orgs for themselves.

create or replace function create_org_with_business(
  p_org_name text,
  p_business_name text,
  p_business_slug text
)
returns table(org_id uuid, business_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_business_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  insert into orgs (name) values (p_org_name) returning id into v_org_id;
  insert into org_members (org_id, user_id, role) values (v_org_id, auth.uid(), 'owner');
  insert into businesses (org_id, name, slug) values (v_org_id, p_business_name, p_business_slug)
    returning id into v_business_id;
  insert into loyalty_cards (business_id, name, reward_type, target_count, reward_description)
    values (v_business_id, p_business_name, 'stamps', 10, '10 = מתנה');
  insert into subscriptions (org_id, plan_tier, status, price_agorot)
    values (v_org_id, 'basic', 'trialing', 0);

  return query select v_org_id, v_business_id;
end;
$$;

revoke execute on function create_org_with_business(text, text, text) from public;
revoke execute on function create_org_with_business(text, text, text) from anon;
grant execute on function create_org_with_business(text, text, text) to authenticated;
