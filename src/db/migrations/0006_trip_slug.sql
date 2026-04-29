-- Short, URL-safe identifier per trip so the SPA can persist the
-- "currently open trip" in the address bar and survive a page refresh.
-- Backfilled on boot for any pre-existing rows; new trips get a slug
-- assigned in createTrip().

ALTER TABLE trips ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX idx_trips_slug ON trips(slug) WHERE slug IS NOT NULL;
