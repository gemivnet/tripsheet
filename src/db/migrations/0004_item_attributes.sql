-- 0004_item_attributes.sql
-- Per-item structured attributes. Stored as a JSON blob so each `kind`
-- can carry its own field set without a schema migration per kind. The
-- TypeScript registry in src/itemKinds/ defines the typed schema and
-- the form rendering for each kind.

ALTER TABLE items ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '{}';
