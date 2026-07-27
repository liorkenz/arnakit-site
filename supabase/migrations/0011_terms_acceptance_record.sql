-- A checkbox in the UI alone isn't an audit trail. Record when each org's owner
-- actually accepted the terms, server-side and timestamped.
alter table orgs add column terms_accepted_at timestamptz;

-- Replacing the 3-arg version with a 4-arg one would leave BOTH overloads callable
-- (Postgres distinguishes functions by argument list, not just name) — the old one
-- wouldn't enforce ToS acceptance at all, so it must be dropped explicitly.
drop function if exists create_org_with_business(text, text, text);

create or replace function create_org_with_business(
  p_org_name text,
  p_business_name text,
  p_business_slug text,
  p_accepted_terms boolean default false
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

  if not p_accepted_terms then
    raise exception 'must accept terms of service to create an organization';
  end if;

  insert into orgs (name, terms_accepted_at) values (p_org_name, now()) returning id into v_org_id;
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

revoke execute on function create_org_with_business(text, text, text, boolean) from public;
revoke execute on function create_org_with_business(text, text, text, boolean) from anon;
grant execute on function create_org_with_business(text, text, text, boolean) to authenticated;
