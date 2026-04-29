---
'tripsheet': minor
---

✨ Add `POST /api/trips/:id/reimport` to wipe a trip's items and rebuild them from a parsed reference doc in one transactional pass. The route runs the parser first (slow, network-bound) so a failure leaves the existing trip untouched, then atomically deletes the old items and re-creates them via the standard `createItem` path so every kind-specific derivation runs on each one. Returns `{ deleted, created }` so the UI can confirm the operation.
