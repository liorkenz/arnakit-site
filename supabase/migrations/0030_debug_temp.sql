-- TEMPORARY diagnostic function, to be dropped by the very next migration.
create or replace function debug_check_overloads()
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_agg(jsonb_build_object(
    'oid', p.oid::text,
    'args', pg_get_function_identity_arguments(p.oid),
    'acl', p.proacl::text
  ))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_org_with_business';
$$;

grant execute on function debug_check_overloads() to authenticated;
