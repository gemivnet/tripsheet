-- 0002_doc_links_and_trip_meta.sql
-- Link plan items back to the reference doc they came from, and record
-- trip-level metadata + the derived trip id on reference docs that the
-- importer auto-builds a trip from.

ALTER TABLE items ADD COLUMN source_doc_id INTEGER REFERENCES reference_docs(id) ON DELETE SET NULL;
CREATE INDEX idx_items_source_doc ON items(source_doc_id);

ALTER TABLE reference_docs ADD COLUMN parsed_trip_json TEXT;
ALTER TABLE reference_docs ADD COLUMN derived_trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL;
CREATE INDEX idx_reference_docs_derived_trip ON reference_docs(derived_trip_id);
