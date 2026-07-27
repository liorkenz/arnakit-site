-- Arnakit core schema: orgs -> businesses (branches) -> loyalty_cards / customers -> stamp_events

create extension if not exists "pgcrypto";

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table org_members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table businesses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  slug text not null unique,
  category text,
  timezone text not null default 'Asia/Jerusalem',
  created_at timestamptz not null default now()
);
create index idx_businesses_org on businesses(org_id);

create table loyalty_cards (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  reward_type text not null check (reward_type in ('stamps', 'credit')),
  target_count int,
  credit_target_amount numeric,
  color_c1 text not null default '#1b3a3a',
  color_c2 text not null default '#0e1f1f',
  stamp_color text not null default '#49d6c4',
  background_image_url text,
  reward_description text,
  apple_pass_type_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_loyalty_cards_business on loyalty_cards(business_id);

create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  pass_serial_number text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  pass_auth_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  google_object_id text unique,
  stamps_count int not null default 0,
  credit_balance_agorot int not null default 0,
  phone text,
  email text,
  platform text check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_visit_at timestamptz
);
create index idx_customers_business on customers(business_id);

create table stamp_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  delta int not null,
  type text not null check (type in ('stamp', 'credit', 'redeem', 'reset')),
  created_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now()
);
create index idx_stamp_events_customer on stamp_events(customer_id);
create index idx_stamp_events_business on stamp_events(business_id);

create table apple_devices (
  device_library_identifier text not null,
  pass_type_identifier text not null,
  push_token text not null,
  serial_number text not null,
  customer_id uuid not null references customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (device_library_identifier, pass_type_identifier, serial_number)
);
create index idx_apple_devices_customer on apple_devices(customer_id);

create table pass_update_queue (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  reason text not null,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_pass_update_queue_unprocessed on pass_update_queue(processed) where not processed;

create table push_campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  message text not null,
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  sent_count int not null default 0,
  created_by uuid references auth.users(id),
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_push_campaigns_business on push_campaigns(business_id);

-- Auto-update updated_at on loyalty_cards
create or replace function fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_loyalty_cards_updated_at
before update on loyalty_cards
for each row execute function fn_set_updated_at();

-- Apply the stamp/credit delta to the customer's running balance
create or replace function fn_apply_stamp_delta()
returns trigger
language plpgsql
as $$
begin
  if new.type in ('stamp', 'reset') then
    update customers
      set stamps_count = greatest(0, stamps_count + new.delta),
          last_visit_at = now()
      where id = new.customer_id;
  elsif new.type in ('credit', 'redeem') then
    update customers
      set credit_balance_agorot = greatest(0, credit_balance_agorot + new.delta),
          last_visit_at = now()
      where id = new.customer_id;
  end if;
  return new;
end;
$$;

create trigger trg_stamp_events_apply_delta
after insert on stamp_events
for each row execute function fn_apply_stamp_delta();

-- Queue a wallet push whenever a customer's stamp/credit balance changes
create or replace function fn_queue_pass_update()
returns trigger
language plpgsql
as $$
begin
  insert into pass_update_queue (customer_id, reason)
  values (new.customer_id, new.type);
  return new;
end;
$$;

create trigger trg_stamp_events_queue_update
after insert on stamp_events
for each row execute function fn_queue_pass_update();
