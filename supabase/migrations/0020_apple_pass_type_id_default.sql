-- Arnakit has a single Apple Pass Type ID for the whole platform (one Apple
-- Developer account issuing every merchant's card), not one per business —
-- so this is a platform-wide default, not something merchants configure.
alter table loyalty_cards alter column apple_pass_type_id set default 'pass.co.il.arnakit.loyalty';
update loyalty_cards set apple_pass_type_id = 'pass.co.il.arnakit.loyalty' where apple_pass_type_id is null;
