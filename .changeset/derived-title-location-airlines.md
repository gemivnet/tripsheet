---
'tripsheet': minor
---

✨ Auto-derive title and location for kinds whose structured fields fully determine them.

The editor's generic Title and Location inputs are now hidden for kinds where the structured form is the canonical source: flights ("AA 2364 · ORD → LAX"), check-in / check-out ("Check-in · property name"), and meals ("Dinner · venue"). Reservation, activity, and package keep a user-typed title but auto-derive location from venue/operator. The server overwrites these base columns from the kind's `derive()` on every save so they stay in sync as the user edits the structured fields.

Bidirectional sync for time/date on `ownsTime` kinds: when an item carries `day_date` / `start_time` / `end_time` at the base level (e.g. from a PDF parse) but the matching structured field is empty, the editor pre-fills from the base so the user sees real values instead of blank inputs. Their edits flow back through the structured field, which derives back to base.

Airline names + flight numbers are now normalized server-side: free-text "Southwest" becomes IATA "WN", "AA2364" / "aa-2364" / "AA 2364" all become "AA 2364". Backed by a known-airline table that also stores each carrier's online check-in window for upcoming features. Unknown carriers pass through untouched so the user never loses input.

Existing items pick this up automatically: a boot-time backfill walks every row, re-runs the per-kind normalize/derive pipeline, and updates rows whose stored values differ from the freshly-derived ones. Idempotent; safe across restarts.
