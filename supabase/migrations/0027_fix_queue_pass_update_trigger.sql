-- Bug: fn_queue_pass_update() ran as the CALLING role (the authenticated
-- dashboard user), not service_role. pass_update_queue intentionally has no
-- client RLS policies at all (Edge Functions only), so every insert into
-- stamp_events — adding a stamp, recording a credit purchase, redeeming a
-- reward, resetting a card — failed with "new row violates row-level
-- security policy for table pass_update_queue" and rolled back the whole
-- stamp_events insert. The customer-facing symptom: clicking "+ תו" (or any
-- other loyalty action) silently did nothing, no error shown anywhere.
-- Fix: run the trigger function as its owner (service_role-equivalent), same
-- pattern already used for next_receipt_number()/bootstrap_platform_admin().
create or replace function fn_queue_pass_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into pass_update_queue (customer_id, reason)
  values (new.customer_id, new.type);
  return new;
end;
$$;
