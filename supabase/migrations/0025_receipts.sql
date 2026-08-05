-- Automatic receipts for Arnakit's own subscription payments (from merchants
-- paying Arnakit, not merchants' own customers). Legal requirement for an
-- עוסק פטור: sequential, gap-free numbering. A plain "select count(*)+1"
-- would race under concurrent webhook deliveries and could produce duplicate
-- or skipped numbers — a Postgres sequence guarantees atomic, gap-free
-- increments regardless of concurrency.
create sequence receipt_number_seq start with 1;

-- supabase-js can't call nextval() directly against a bare sequence — this
-- narrow, service_role-only wrapper is the only way to draw the next number.
create or replace function next_receipt_number()
returns bigint
language sql
security definer
set search_path = public
as $$
  select nextval('receipt_number_seq');
$$;

revoke execute on function next_receipt_number() from public;
revoke execute on function next_receipt_number() from anon;
revoke execute on function next_receipt_number() from authenticated;
grant execute on function next_receipt_number() to service_role;

alter table invoices add column receipt_number bigint;
alter table invoices add column receipt_storage_path text;

-- Private bucket (unlike card-backgrounds): these are financial documents,
-- never publicly listable or fetchable by a bare URL. Access only via a
-- short-lived signed URL issued by the download-receipt Edge Function after
-- an explicit membership check.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- No storage.objects policies for anon/authenticated at all — every read
-- goes through download-receipt (service_role, explicit auth check), every
-- write through cardcom-webhook (service_role). Matches the same
-- "RLS enabled, zero client policies" pattern already used for
-- billing_webhook_log/waitlist after the security audit.
