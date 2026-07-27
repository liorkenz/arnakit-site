-- Lets a business configure "what % of the purchase amount becomes credit" per
-- card, instead of a platform-wide fixed rate — a cafe and a fine-dining place
-- don't run the same margins. Only meaningful for reward_type = 'credit'.
alter table loyalty_cards add column credit_earn_rate_percent numeric not null default 10;
