-- Optional anti-abuse setting: when enabled on a card, a customer can only
-- earn one stamp per 24h — stops a customer (or a careless staff member)
-- from tapping "+ תו" repeatedly to fast-track a reward.
alter table loyalty_cards add column stamp_cooldown_enabled boolean not null default false;

-- Enforced as a BEFORE INSERT trigger (not just client-side) so it can't be
-- bypassed by calling the insert directly — same defense-in-depth pattern as
-- the rest of this schema's business-rule triggers.
create or replace function fn_enforce_stamp_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cooldown_enabled boolean;
  v_recent_stamp timestamptz;
begin
  if new.type != 'stamp' then
    return new;
  end if;

  select stamp_cooldown_enabled into v_cooldown_enabled
  from loyalty_cards
  where org_id = new.org_id and is_active = true
  order by created_at asc
  limit 1;

  if not coalesce(v_cooldown_enabled, false) then
    return new;
  end if;

  select created_at into v_recent_stamp
  from stamp_events
  where customer_id = new.customer_id and type = 'stamp'
  order by created_at desc
  limit 1;

  if v_recent_stamp is not null and v_recent_stamp > now() - interval '24 hours' then
    raise exception 'stamp_cooldown_active' using hint = 'customer already received a stamp within the last 24 hours';
  end if;

  return new;
end;
$$;

create trigger trg_stamp_events_enforce_cooldown
before insert on stamp_events
for each row execute function fn_enforce_stamp_cooldown();
