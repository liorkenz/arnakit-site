-- Enforces the plan limits already advertised on the pricing section: basic = 1
-- business (branch) and 1 loyalty card; featured = unlimited cards but still 1
-- branch; chain = unlimited branches. Enforced server-side via trigger (not just
-- hidden/disabled in the dashboard UI) so a direct REST call can't bypass it —
-- consistent with the "never trust the client" pattern already used for chain pricing.
create or replace function fn_enforce_plan_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_plan text;
  v_count int;
begin
  if TG_TABLE_NAME = 'businesses' then
    v_org_id := new.org_id;
    select plan_tier into v_plan from subscriptions where org_id = v_org_id;

    if v_plan is distinct from 'chain' then
      select count(*) into v_count from businesses where org_id = v_org_id;
      if v_count >= 1 then
        raise exception 'התוכנית הנוכחית מוגבלת לסניף אחד. שדרגו לתוכנית "רשת" כדי להוסיף סניפים נוספים.';
      end if;
    end if;

  elsif TG_TABLE_NAME = 'loyalty_cards' then
    select b.org_id into v_org_id from businesses b where b.id = new.business_id;
    select plan_tier into v_plan from subscriptions where org_id = v_org_id;

    if v_plan = 'basic' then
      select count(*) into v_count from loyalty_cards where business_id = new.business_id;
      if v_count >= 1 then
        raise exception 'התוכנית הבסיסית מוגבלת לכרטיס אחד. שדרגו לתוכנית המומלצת כדי להוסיף כרטיסים נוספים.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_businesses_plan_limit on businesses;
create trigger trg_businesses_plan_limit
before insert on businesses
for each row execute function fn_enforce_plan_limits();

drop trigger if exists trg_loyalty_cards_plan_limit on loyalty_cards;
create trigger trg_loyalty_cards_plan_limit
before insert on loyalty_cards
for each row execute function fn_enforce_plan_limits();
