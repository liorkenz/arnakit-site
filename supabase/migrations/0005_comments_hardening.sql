-- The `comments` table already exists in production (created manually, see original
-- index.html README instructions) with columns: name, business, text, approved, created_at.
-- This migration is idempotent so it's safe to run against that existing table, and also
-- creates it from scratch for fresh environments (e.g. `supabase start` local dev).

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business text,
  text text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

alter table comments enable row level security;

drop policy if exists comments_select_approved on comments;
create policy comments_select_approved on comments
  for select using (approved = true);

drop policy if exists comments_insert_anon on comments;
create policy comments_insert_anon on comments
  for insert with check (true);

-- Hardening: the current client sends `approved: false` itself, but nothing on the
-- server stops a direct REST call from passing `approved: true`. Force it server-side
-- regardless of what the insert payload contains.
create or replace function fn_force_comment_unapproved()
returns trigger
language plpgsql
as $$
begin
  new.approved = false;
  return new;
end;
$$;

drop trigger if exists trg_comments_force_unapproved on comments;
create trigger trg_comments_force_unapproved
before insert on comments
for each row execute function fn_force_comment_unapproved();
