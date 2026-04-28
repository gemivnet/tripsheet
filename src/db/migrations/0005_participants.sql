-- 0005_participants.sql
-- Participants are the people on a trip. They may or may not have a
-- tripsheet account — `user_id` is nullable so the user can add a
-- friend/family member by name without creating an account for them.
--
-- `item_participants` is the join table: who is attending which item.
-- The convention when an item has zero rows in this table is "everyone"
-- (the trip's full participant list); explicit rows narrow it.

CREATE TABLE participants (
  id INTEGER PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  color_hue INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_participants_trip ON participants(trip_id);
CREATE INDEX idx_participants_user ON participants(user_id);

CREATE TABLE item_participants (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, participant_id)
);
CREATE INDEX idx_item_participants_participant ON item_participants(participant_id);
