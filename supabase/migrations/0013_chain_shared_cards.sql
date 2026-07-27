-- A chain's whole point is customers earning/spending stamps at ANY branch — the
-- previous design tied loyalty_cards and customers to a single business (branch),
-- so a chain's locations never shared a customer or a card. This moves both to the
-- org level: one shared card (or set of cards, for featured/chain) per chain,
-- reachable from every branch's QR link, with a shared customer pool.

-- ===== loyalty_cards: now org-scoped =====
alter table loyalty_cards add column org_id uuid references orgs(id) on delete cascade;
update loyalty_cards lc set org_id = b.org_id from businesses b where b.id = lc.business_id;
alter table loyalty_cards alter column org_id set not null;
create index idx_loyalty_cards_org on loyalty_cards(org_id);
-- business_id itself is dropped further down, after the policies referencing
-- it are dropped too (Postgres won't let you drop a column a policy depends on).

-- ===== customers: now org-scoped; which branch they first scanned at is kept
-- for analytics only, not for access control =====
alter table customers rename column business_id to enrolled_business_id;
alter table customers alter column enrolled_business_id drop not null;
alter table customers add column org_id uuid references orgs(id) on delete cascade;
update customers c set org_id = b.org_id from businesses b where b.id = c.enrolled_business_id;
alter table customers alter column org_id set not null;
create index idx_customers_org on customers(org_id);

-- ===== stamp_events: org_id becomes the RLS scoping key; business_id stays as
-- "which branch performed this" for analytics =====
alter table stamp_events add column org_id uuid references orgs(id) on delete cascade;
update stamp_events se set org_id = b.org_id from businesses b where b.id = se.business_id;
alter table stamp_events alter column org_id set not null;
alter table stamp_events alter column business_id drop not null;
create index idx_stamp_events_org on stamp_events(org_id);

-- ===== push_campaigns: same pattern =====
alter table push_campaigns add column org_id uuid references orgs(id) on delete cascade;
update push_campaigns pc set org_id = b.org_id from businesses b where b.id = pc.business_id;
alter table push_campaigns alter column org_id set not null;
alter table push_campaigns alter column business_id drop not null;
create index idx_push_campaigns_org on push_campaigns(org_id);

-- ===== RLS: swap business-scoped policies for org-scoped ones =====
drop policy if exists loyalty_cards_select_member on loyalty_cards;
drop policy if exists loyalty_cards_insert_member on loyalty_cards;
drop policy if exists loyalty_cards_update_member on loyalty_cards;
alter table loyalty_cards drop column business_id;
create policy loyalty_cards_select_member on loyalty_cards for select using (is_org_member_of(org_id));
create policy loyalty_cards_insert_member on loyalty_cards for insert with check (is_org_member_of(org_id));
create policy loyalty_cards_update_member on loyalty_cards for update using (is_org_member_of(org_id));

drop policy if exists customers_select_member on customers;
create policy customers_select_member on customers for select using (is_org_member_of(org_id));

drop policy if exists stamp_events_select_member on stamp_events;
drop policy if exists stamp_events_insert_member on stamp_events;
create policy stamp_events_select_member on stamp_events for select using (is_org_member_of(org_id));
create policy stamp_events_insert_member on stamp_events for insert with check (is_org_member_of(org_id));

drop policy if exists push_campaigns_select_member on push_campaigns;
drop policy if exists push_campaigns_insert_member on push_campaigns;
create policy push_campaigns_select_member on push_campaigns for select using (is_org_member_of(org_id));
create policy push_campaigns_insert_member on push_campaigns for insert with check (is_org_member_of(org_id));

-- card-backgrounds storage paths are now written as `${org.id}/...` from the
-- dashboard (previously `${business.id}/...`), so the folder-ownership check
-- needs to test org membership directly instead of via a business join.
drop policy if exists card_backgrounds_member_write on storage.objects;
drop policy if exists card_backgrounds_member_update on storage.objects;
create policy card_backgrounds_member_write on storage.objects
  for insert with check (bucket_id = 'card-backgrounds' and is_org_member_of((storage.foldername(name))[1]::uuid));
create policy card_backgrounds_member_update on storage.objects
  for update using (bucket_id = 'card-backgrounds' and is_org_member_of((storage.foldername(name))[1]::uuid));

-- ===== plan-limit trigger: card count is now per-org, not per-business =====
create or replace function fn_enforce_plan_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_count int;
begin
  if TG_TABLE_NAME = 'businesses' then
    select plan_tier into v_plan from subscriptions where org_id = new.org_id;

    if v_plan is distinct from 'chain' then
      select count(*) into v_count from businesses where org_id = new.org_id;
      if v_count >= 1 then
        raise exception 'התוכנית הנוכחית מוגבלת לסניף אחד. שדרגו לתוכנית "רשת" כדי להוסיף סניפים נוספים.';
      end if;
    end if;

  elsif TG_TABLE_NAME = 'loyalty_cards' then
    select plan_tier into v_plan from subscriptions where org_id = new.org_id;

    if v_plan = 'basic' then
      select count(*) into v_count from loyalty_cards where org_id = new.org_id;
      if v_count >= 1 then
        raise exception 'התוכנית הבסיסית מוגבלת לכרטיס אחד. שדרגו לתוכנית המומלצת כדי להוסיף כרטיסים נוספים.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ===== onboarding RPC: create the first card at org level, not business level =====
drop function if exists create_org_with_business(text, text, text, boolean);

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
  insert into loyalty_cards (org_id, name, reward_type, target_count, reward_description)
    values (v_org_id, p_business_name, 'stamps', 10, '10 = מתנה');
  insert into subscriptions (org_id, plan_tier, status, price_agorot)
    values (v_org_id, 'basic', 'trialing', 0);

  return query select v_org_id, v_business_id;
end;
$$;

revoke execute on function create_org_with_business(text, text, text, boolean) from public;
revoke execute on function create_org_with_business(text, text, text, boolean) from anon;
grant execute on function create_org_with_business(text, text, text, boolean) to authenticated;

-- ===== add-branch RPC for chain-tier orgs (dashboard "+ סניף" action) =====
create or replace function create_business_for_org(p_org_id uuid, p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
begin
  if not is_org_member_of(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  insert into businesses (org_id, name, slug) values (p_org_id, p_name, p_slug)
    returning id into v_business_id;

  return v_business_id;
end;
$$;

revoke execute on function create_business_for_org(uuid, text, text) from public;
revoke execute on function create_business_for_org(uuid, text, text) from anon;
grant execute on function create_business_for_org(uuid, text, text) to authenticated;
