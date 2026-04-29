---
'tripsheet': minor
---

✨ Show "online check-in opens" markers on the timeline for every flight, placed at `departure_local - airline.checkInWindowHours`. Computed at render time from the flight's structured attributes — no DB rows, no sync issues. Per-airline window mirrors the server's airline table (24h default, with overrides for the carriers that differ — Lufthansa/Swiss/Austrian 23h; Aeromexico, Singapore, Cathay, Emirates, Qatar, Korean, Asiana, China carriers, IndiGo, Jetstar 48h; Vueling 7d; easyJet 30d; SAS 22h). Marker is a small clickable pill that jumps to the parent flight; counts/warnings/drag-reorder ignore it the same way they ignore the existing arrival shadows.
