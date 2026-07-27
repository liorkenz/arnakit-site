create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  plan_tier text not null check (plan_tier in ('basic', 'featured', 'chain')),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled')),
  payment_provider text not null default 'cardcom',
  provider_customer_id text,
  provider_token_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  price_agorot int not null default 0,
  failed_attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index idx_subscriptions_org on subscriptions(org_id);

create trigger trg_subscriptions_updated_at
before update on subscriptions
for each row execute function fn_set_updated_at();

create table invoices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  provider_charge_id text,
  amount_agorot int not null,
  status text not null check (status in ('success', 'failed')),
  invoice_doc_url text,
  created_at timestamptz not null default now()
);
create index idx_invoices_org on invoices(org_id);
create index idx_invoices_subscription on invoices(subscription_id);

create table billing_webhook_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_type text,
  external_id text,
  payload jsonb not null,
  processed boolean not null default false,
  received_at timestamptz not null default now()
);
-- idempotency: never process the same provider event twice
create unique index idx_billing_webhook_log_dedupe on billing_webhook_log(provider, external_id)
  where external_id is not null;

create table waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now()
);
create unique index idx_waitlist_email on waitlist(lower(email));

alter table subscriptions enable row level security;
alter table invoices enable row level security;
-- billing_webhook_log and waitlist: no client policies, Edge Functions only via service_role.

create policy subscriptions_select_member on subscriptions
  for select using (is_org_member_of(org_id));

create policy invoices_select_member on invoices
  for select using (is_org_member_of(org_id));
