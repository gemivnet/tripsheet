---
'tripsheet': minor
---

✨ Two fixes around multi-day bookings:

- Multi-day-spanning items now show their actual day offset on the timeline. A flight that lands two calendar days after departure reads "+2d" (and "+3d" if longer); previously every multi-day end was hardcoded to "+1d".
- New `booked_under_name` attribute on flights, check-in/check-out, meals, reservations, and packages — captures whose name the booking is held under, since the trip's planner often differs from the named passenger/guest. Pulled out of PDFs by the parser when the document names the booking holder.

Also: the timeline no longer renders "X between" pills around synthetic markers (online check-in opens, arrival shadows) — they're not real schedule entries, so measuring gaps against them only added noise.
