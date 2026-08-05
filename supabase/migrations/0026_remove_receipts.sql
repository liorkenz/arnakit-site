-- Reverts 0025_receipts.sql: Arnakit's own subscription invoicing/receipts
-- move to Green Invoice instead of an in-house generator, so this schema is
-- unused. The 'receipts' storage bucket itself was already emptied and
-- deleted via the Storage API (SQL can't touch storage.objects directly).
alter table invoices drop column if exists receipt_storage_path;
alter table invoices drop column if exists receipt_number;

drop function if exists next_receipt_number();
drop sequence if exists receipt_number_seq;
