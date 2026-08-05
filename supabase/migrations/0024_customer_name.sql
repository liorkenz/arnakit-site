-- Customers previously had no name at all — the dashboard's customer list
-- fell back to showing the first 8 characters of an internal serial number,
-- useless for actually recognizing who someone is. Collected once at
-- enrollment (join.html), not by staff later, to keep this fully automatic.
alter table customers add column name text;
