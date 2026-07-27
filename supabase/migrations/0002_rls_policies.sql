-- RLS: dashboard users (authenticated, org members) get scoped access to their own org's data.
-- Public/anon access to customer-facing data (pass issuance, wallet updates, webhooks) goes
-- through Edge Functions using the service_role key, NOT direct PostgREST access — those tables
-- get no anon policies at all here.

alter table orgs enable row level security;
alter table org_members enable row level security;
alter table businesses enable row level security;
alter table loyalty_cards enable row level security;
alter table customers enable row level security;
alter table stamp_events enable row level security;
alter table apple_devices enable row level security;
alter table pass_update_queue enable row level security;
alter table push_campaigns enable row level security;

-- Helper: is the current authenticated user a member of the org that owns this business?
create or replace function is_org_member(p_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from businesses b
    join org_members om on om.org_id = b.org_id
    where b.id = p_business_id
      and om.user_id = auth.uid()
  );
$$;

-- Helper: is the current authenticated user a member of this org directly?
create or replace function is_org_member_of(p_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from org_members om
    where om.org_id = p_org_id and om.user_id = auth.uid()
  );
$$;

revoke execute on function is_org_member(uuid) from anon;
revoke execute on function is_org_member_of(uuid) from anon;
grant execute on function is_org_member(uuid) to authenticated;
grant execute on function is_org_member_of(uuid) to authenticated;

create policy org_members_select_own on org_members
  for select using (user_id = auth.uid());

create policy orgs_select_member on orgs
  for select using (is_org_member_of(id));

create policy businesses_select_member on businesses
  for select using (is_org_member_of(org_id));
create policy businesses_insert_member on businesses
  for insert with check (is_org_member_of(org_id));
create policy businesses_update_member on businesses
  for update using (is_org_member_of(org_id));

create policy loyalty_cards_select_member on loyalty_cards
  for select using (is_org_member(business_id));
create policy loyalty_cards_insert_member on loyalty_cards
  for insert with check (is_org_member(business_id));
create policy loyalty_cards_update_member on loyalty_cards
  for update using (is_org_member(business_id));

create policy customers_select_member on customers
  for select using (is_org_member(business_id));

create policy stamp_events_select_member on stamp_events
  for select using (is_org_member(business_id));
create policy stamp_events_insert_member on stamp_events
  for insert with check (is_org_member(business_id));

create policy push_campaigns_select_member on push_campaigns
  for select using (is_org_member(business_id));
create policy push_campaigns_insert_member on push_campaigns
  for insert with check (is_org_member(business_id));

-- apple_devices and pass_update_queue: no client policies at all (Edge Functions only, via service_role).

-- Storage: card background photos, publicly readable (Apple/Google servers fetch them
-- unauthenticated), writable only by the org member that owns the business folder.
insert into storage.buckets (id, name, public)
values ('card-backgrounds', 'card-backgrounds', true)
on conflict (id) do nothing;

create policy card_backgrounds_public_read on storage.objects
  for select using (bucket_id = 'card-backgrounds');

create policy card_backgrounds_member_write on storage.objects
  for insert with check (
    bucket_id = 'card-backgrounds'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );

create policy card_backgrounds_member_update on storage.objects
  for update using (
    bucket_id = 'card-backgrounds'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );
