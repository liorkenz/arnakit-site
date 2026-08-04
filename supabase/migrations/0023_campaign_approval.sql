-- Staff/managers could previously send a campaign message to every customer
-- unrestricted, same as the owner — the owner wants final say over what goes
-- out under the business's name. Non-owners now submit a request instead;
-- only the owner can approve (which actually sends it) or reject it.
create table campaign_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  message text not null,
  requested_by uuid not null,
  requested_by_email text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_campaign_requests_org on campaign_requests(org_id);

alter table campaign_requests enable row level security;

create policy campaign_requests_select_member on campaign_requests
  for select using (is_org_member_of(org_id));

create policy campaign_requests_insert_member on campaign_requests
  for insert with check (is_org_member_of(org_id) and requested_by = auth.uid());
