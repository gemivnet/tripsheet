---
'tripsheet': minor
---

🔀 Rework document import. Uploads are now classified after parse and routed automatically: itineraries auto-build a new trip with items applied directly; confirmations uploaded inside a trip try to attach to a matching item (filling in confirmation/url/notes) and fall back to a swipe-deck suggestion when no match exists; journals and other reference docs land in the memory cache. Items now carry a `source_doc_id` link back to the PDF they came from, exposed in the UI as a paperclip badge. Includes a backfill script (`scripts/backfill-doc-links.ts`) that re-routes existing library itineraries through the new logic.
