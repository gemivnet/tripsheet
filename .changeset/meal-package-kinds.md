---
'tripsheet': minor
---

✨ Add two new item kinds — `meal` and `package` — and reshape the editor around them.

- **`meal`** covers anything eating-related (breakfast, brunch, lunch, dinner, drinks, snack) with structured fields for venue, cuisine, party size, price level, and dress code. The reservation/booking code goes in the existing top-level `confirmation` field. Time and confirmation are both optional, so loose plans like "dinner somewhere in the old town" model cleanly.
- **`package`** covers any multi-day single booking — guided tours, cruises, all-inclusive resorts, retreats, cooking schools — with operator, end date/time, lodging-included flag, meal-plan flag, price, and cancellation. When `includes_lodging: yes`, the days inside the package automatically count as lodging on the timeline so the user doesn't have to add separate check-in/check-out items. Days strictly between start and end render an "X continues through this day" banner.

Supporting changes:
- New "tonight" lodging footer at the bottom of each day, derived from active check-in/check-out pairs and packages-with-lodging across the whole trip.
- Add-mode form now exposes start/end time, confirmation, and per-kind structured attributes — so creating a meal or package in one shot is possible without first creating the item and then editing it. The KindAttributes component now supports both edit (commits live) and add (writes to local form state) modes.
- Day "no meals planned" warning now recognises items of kind `meal` and packages whose `includes_meals` is `yes`/`some`. Check-in/check-out time warnings now skip travel days entirely (a morning errand before flying out is naturally before destination check-in time and shouldn't warn). Activity gaps now use end_time when present so a 2h activity at 09:00 doesn't trigger a phantom gap against a 14:00 next item.
- Reimport button on the PDF tab calls the new `/reimport` route, gated behind a click-twice confirm so it can't be triggered by accident.
- PDF parser prompt updated to map any eating-related entry to `meal`, multi-day all-inclusive entries to `package`, and to list both kinds in the JSON schema it returns.
- Per-day item count now ignores the synthetic arrival shadow rendered on a transit's arrival day so "2 items" doesn't get inflated to "3 items" when one of them is a render-only ghost.
