-- Security audit fixes (RLS / public-access findings from `supabase db advisors`).

-- ===== CRITICAL: waitlist and billing_webhook_log had RLS disabled entirely,
-- meaning the public anon key (embedded in the marketing site's HTML/JS) could
-- read every row via PostgREST — waitlist.email (real signup emails) and
-- billing_webhook_log (Cardcom payment webhook payloads). Both tables are only
-- ever written via supabaseAdmin (service_role), which always bypasses RLS, so
-- enabling RLS with zero anon/authenticated policies fully locks out clients
-- without breaking either function.
alter table waitlist enable row level security;
alter table billing_webhook_log enable row level security;

-- ===== comments: migration 0005 created `comments_insert_anon` without dropping
-- the original policy from the table's creation, leaving two redundant
-- WITH CHECK (true) INSERT policies doing the same thing. Not a hole (the
-- fn_force_comment_unapproved trigger still forces approved=false either way,
-- and the SELECT policy only exposes approved=true rows) — just dead weight.
drop policy if exists "Anyone can insert a comment" on comments;

-- ===== storage: card-backgrounds is a public bucket (direct-URL image access
-- is intentional and unaffected by this), but this extra SELECT policy on
-- storage.objects additionally let anyone LIST every file across every org's
-- folder — enumerating every org's UUID and uploaded filenames. Public buckets
-- don't need this policy for normal `/object/public/...` URL access.
drop policy if exists card_backgrounds_public_read on storage.objects;

-- ===== function hardening: these trigger functions had no fixed search_path,
-- the standard Postgres advisory for any function (search_path resolution
-- could be influenced by objects created earlier in the path). None of these
-- are SECURITY DEFINER so the practical risk was low, but it's a free fix.
alter function fn_set_updated_at() set search_path = public;
alter function fn_apply_stamp_delta() set search_path = public;
alter function fn_queue_pass_update() set search_path = public;
alter function fn_force_comment_unapproved() set search_path = public;
