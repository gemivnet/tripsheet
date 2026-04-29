---
'tripsheet': patch
---

🐛 Stop displaying negative flight durations. When a transit's stored times are self-contradictory (e.g. arrival_date is +1d when it should be +2d, so the tz-aware math says the plane lands 4½ hours before it leaves), the timeline used to render "−270 MIN". It now suppresses the duration label entirely and surfaces a day-level warning ("'X' lands before it leaves — check the arrival date/time") so the user knows to fix the source.
