-- Chain-manager role: lets a chain owner delegate day-to-day staff management to
-- each branch's own manager (add/remove their own employees) without handing over
-- billing control or the ability to touch other branches.
alter table org_members drop constraint org_members_role_check;
alter table org_members add constraint org_members_role_check check (role in ('owner', 'manager', 'staff'));

alter table org_members add column business_id uuid references businesses(id) on delete set null;

-- True for the org owner (full control) or for a 'manager' scoped to this exact branch.
create or replace function can_manage_staff_at(p_org_id uuid, p_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select is_org_owner_of(p_org_id) or exists (
    select 1 from org_members om
    where om.org_id = p_org_id and om.user_id = auth.uid()
      and om.role = 'manager' and om.business_id = p_business_id
  );
$$;

revoke execute on function can_manage_staff_at(uuid, uuid) from anon;
grant execute on function can_manage_staff_at(uuid, uuid) to authenticated;

-- Replaces the 0018 owner-only delete policy: an owner can remove anyone but
-- another owner; a manager can only remove 'staff' rows at their own branch.
drop policy if exists org_members_delete_by_owner on org_members;
create policy org_members_delete_by_owner on org_members
  for delete using (
    role <> 'owner' and (
      is_org_owner_of(org_id) or
      (role = 'staff' and can_manage_staff_at(org_id, business_id))
    )
  );

-- Custom per-chain pricing: set/edited by a platform admin only (via the admin
-- panel), overriding the auto-computed 5-billed/6th-free chain price for
-- chains where Arnakit negotiated a fixed monthly rate directly.
alter table subscriptions add column custom_price_agorot int;

-- Admin-issued chain-onboarding links: a platform admin fixes the monthly price
-- up front and hands the chain's owner a single link. Completing signup through
-- it locks the new org into plan_tier='chain' at that price, then sends the
-- owner straight to Cardcom to save their card at that same price.
create table chain_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  price_agorot int not null,
  note text,
  org_id uuid references orgs(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- No policies added: this table is only ever touched by Edge Functions using
-- the service_role key (admin creates it, create_org_with_business redeems it).
alter table chain_invites enable row level security;

drop function if exists create_org_with_business(text, text, text, boolean);

create or replace function create_org_with_business(
  p_org_name text,
  p_business_name text,
  p_business_slug text,
  p_accepted_terms boolean default false,
  p_chain_invite_token text default null
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
  v_invite chain_invites%rowtype;
  v_plan text := 'basic';
  v_custom_price int := null;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not p_accepted_terms then
    raise exception 'must accept terms of service to create an organization';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  if p_chain_invite_token is not null then
    select * into v_invite from chain_invites where token = p_chain_invite_token and used_at is null for update;
    if not found then
      raise exception 'invalid or already-used invite link';
    end if;
    v_plan := 'chain';
    v_custom_price := v_invite.price_agorot;
  end if;

  insert into orgs (name, terms_accepted_at) values (p_org_name, now()) returning id into v_org_id;
  insert into org_members (org_id, user_id, role, email) values (v_org_id, auth.uid(), 'owner', v_email);
  insert into businesses (org_id, name, slug) values (v_org_id, p_business_name, p_business_slug)
    returning id into v_business_id;
  insert into loyalty_cards (org_id, name, reward_type, target_count, reward_description)
    values (v_org_id, p_business_name, 'stamps', 10, '10 = מתנה');
  insert into subscriptions (org_id, plan_tier, status, price_agorot, custom_price_agorot)
    values (v_org_id, v_plan, 'trialing', 0, v_custom_price);

  if p_chain_invite_token is not null then
    update chain_invites set used_at = now(), org_id = v_org_id where token = p_chain_invite_token;
  end if;

  return query select v_org_id, v_business_id;
end;
$$;

revoke execute on function create_org_with_business(text, text, text, boolean, text) from public;
revoke execute on function create_org_with_business(text, text, text, boolean, text) from anon;
grant execute on function create_org_with_business(text, text, text, boolean, text) to authenticated;
