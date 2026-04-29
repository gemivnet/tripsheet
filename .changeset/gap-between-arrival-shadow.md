---
'tripsheet': patch
---

🐛 Restore the layover gap pill between a flight's arrival and the next flight. The previous fix that suppressed gap math around synthetic markers went too far — it also hid the gap between an arrival shadow (which represents an actually-completed landing) and the user's next departure on the same day. Now only `_checkInOpen` markers are excluded; arrival shadows still trigger the "Xh between" hint so a tight connection is visible.
