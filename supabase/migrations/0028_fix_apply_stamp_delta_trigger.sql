-- Same bug class as 0027, second trigger on the same table: fn_apply_stamp_delta()
-- ran as the CALLING role and UPDATEs customers.stamps_count/credit_balance_agorot —
-- but customers has no UPDATE policy for authenticated users (only SELECT), so
-- Postgres RLS silently updated zero rows (no error thrown; RLS doesn't error
-- on an UPDATE that matches nothing). Net effect: the stamp_events row got
-- inserted, but the customer's stamps/credit balance never actually moved.
create or replace function fn_apply_stamp_delta()
returns trigger
language plpgsql
security definer
set search_path = public
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
