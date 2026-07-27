-- Amendment 40 to the Telecommunications Law (חוק התקשורת (בזק ושידורים), תיקון 40)
-- requires opt-IN consent before sending advertising messages, plus an easy opt-out.
-- Default is false (no consent) — the enroll flow must set this explicitly true only
-- when the customer actively checks the consent box, never implicitly.
alter table customers add column marketing_consent boolean not null default false;
alter table customers add column consented_at timestamptz;
