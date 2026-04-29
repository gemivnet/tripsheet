---
'tripsheet': minor
---

✨ Trips now have a short URL-safe slug (6 chars, Crockford-base32) that the SPA mirrors into the address bar as `/t/<slug>`. Refreshing the page keeps you on the same trip; the back/forward buttons navigate between trips and the trips index. New trips get a slug at creation time; pre-existing trips are backfilled on boot. The slug is also accepted by `GET /api/trips/:id` so the frontend can fetch a trip without first translating slug → numeric id.
