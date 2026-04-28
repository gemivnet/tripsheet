-- 0003_item_timezone.sql
-- Per-item IANA time zone. Null means "use the trip's default tz" (or
-- user-local if the trip has none). Stored as a plain TEXT column so the
-- value is the IANA name itself, e.g. 'America/New_York', 'Asia/Tokyo'.
-- Used for flight-day items where the start and end legs sit in
-- different zones, and for any item whose location's tz differs from
-- the rest of the trip.

ALTER TABLE items ADD COLUMN tz TEXT;
ALTER TABLE items ADD COLUMN end_tz TEXT;

ALTER TABLE trips ADD COLUMN default_tz TEXT;
