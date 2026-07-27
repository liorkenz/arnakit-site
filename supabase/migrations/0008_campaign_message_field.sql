-- A push alone (silent APNs "content changed" ping / Google object PATCH) doesn't
-- surface any visible text — Apple only shows a lock-screen notification when a field
-- with a `changeMessage` template actually changes value, and Google needs an explicit
-- addMessage call. Store the current campaign text on the card so buildPass.ts can
-- render it into that field.
alter table loyalty_cards add column last_campaign_message text;
