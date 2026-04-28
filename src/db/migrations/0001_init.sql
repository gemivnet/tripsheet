-- 0001_init.sql
-- Initial schema for tripsheet: users, trips, items, AI suggestions,
-- uploaded reference docs + their parsed items, comments, and an audit log.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE trips (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  destination TEXT,
  goals TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  url TEXT,
  confirmation TEXT,
  hours TEXT,
  cost TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Who originally added this item. Shown as the item's "owner" in the UI.
  -- Nullable because suggestions accepted before a user existed (boot-scan
  -- edge case) and items imported via migrations have no single author.
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_items_trip_day ON items(trip_id, day_date, sort_order);

CREATE TABLE suggestions (
  id INTEGER PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_item_id INTEGER,
  payload_json TEXT NOT NULL,
  rationale TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_suggestions_trip_status ON suggestions(trip_id, status, created_at DESC);
CREATE INDEX idx_suggestions_batch ON suggestions(batch_id);

CREATE TABLE reference_docs (
  id INTEGER PRIMARY KEY,
  trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  parsed_summary TEXT,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  parse_error TEXT,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL
);
CREATE INDEX idx_reference_docs_trip ON reference_docs(trip_id);

CREATE TABLE reference_items (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES reference_docs(id) ON DELETE CASCADE,
  day_offset INTEGER,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  notes TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_reference_items_doc ON reference_items(doc_id);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_comments_item ON comments(item_id, created_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  diff_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_recent ON audit_log(created_at DESC);
