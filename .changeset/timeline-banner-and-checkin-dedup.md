---
'tripsheet': minor
---

Three fixes around multi-day flights and synthetic timeline markers:

- The "In transit — X continues through this day" banner now ignores synthetic items when deciding whether a day is "empty." Previously, an unrelated online check-in pill on the same day would suppress the banner; now it surfaces correctly so a day strictly between depart and arrive reads as a travel day.
- Online check-in markers are deduplicated by booking confirmation. Connecting flights on a single PNR open for check-in together, so showing three identical pills for one one-stop itinerary was noise. The first leg of each booking emits the marker; flights without a confirmation each get their own.
- The "no meal plans yet" warning now skips days where flying ≥ 6h dominates — adding a planned meal in the middle of a transpacific is silly, and the warning was the loudest thing on those days.

Also: the participants section in the item editor now always renders. When the trip has zero participants, an empty-state card points the user at the trip-header ribbon to add one — previously the section was hidden entirely so you couldn't tell why it never showed up.
