-- Platform-level admin (the Arnakit operator, not a business owner) — distinct
-- from org_members.role, which only ever scopes access to a single org.
-- No hardcoded email: whoever signs up and calls bootstrap_platform_admin()
-- FIRST becomes the admin; the function is a no-op for everyone after that,
-- so it can't be used to add a second admin without already being one.
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table platform_admins enable row level security;

create policy platform_admins_select_own on platform_admins
  for select using (user_id = auth.uid());

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

  if exists (select 1 from platform_admins limit 1) then
    return false;
  end if;

  insert into platform_admins (user_id) values (auth.uid());
  return true;
end;
$$;

revoke execute on function bootstrap_platform_admin() from public;
revoke execute on function bootstrap_platform_admin() from anon;
grant execute on function bootstrap_platform_admin() to authenticated;
