---
'tripsheet': patch
---

🐛 Day-warning dismissals now stick across reloads. The × on a day's warning banner saves the dismissal to `localStorage`, keyed by trip id + day date + a fingerprint of the warning text. If the warning set changes (a new problem surfaces or the existing one resolves and a different one appears), the banner re-shows automatically — so we never silently hide new issues.
