-- Chain-tier pricing: businesses 1-5 are billed at the featured price, every 6th business
-- (per group of 6) is free. This logic must never be shipped to any client-facing code —
-- only the billing-cron Edge Function (using the service_role key) is allowed to call it.
-- The dashboard only ever reads the resulting subscriptions.price_agorot, never recomputes it.

create or replace function fn_chain_price(p_org_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_count int;
  v_billable_branches int;
  v_price_per_branch_agorot constant int := 23000; -- ₪230/mo, same as the featured tier
begin
  select count(*) into v_branch_count
  from businesses
  where org_id = p_org_id;

  if v_branch_count <= 0 then
    return 0;
  end if;

  -- for every group of 6 branches, only 5 are billed
  v_billable_branches := v_branch_count - (v_branch_count / 6);

  return v_billable_branches * v_price_per_branch_agorot;
end;
$$;

revoke execute on function fn_chain_price(uuid) from public;
revoke execute on function fn_chain_price(uuid) from anon;
revoke execute on function fn_chain_price(uuid) from authenticated;
grant execute on function fn_chain_price(uuid) to service_role;
