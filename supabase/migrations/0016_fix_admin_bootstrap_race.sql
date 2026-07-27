-- Security audit finding: the original check-then-insert wasn't atomic — two
-- concurrent calls before the first commits could both see an empty table and
-- both become platform admin. An advisory lock serializes the whole function
-- body so only one caller can ever win the race.
create or replace function bootstrap_platform_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtext('bootstrap_platform_admin'));

  if exists (select 1 from platform_admins limit 1) then
    return false;
  end if;

  insert into platform_admins (user_id) values (auth.uid());
  return true;
end;
$$;
