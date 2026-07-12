---
'tripsheet': patch
---

🔥 Remove the unused `src/retry.ts` helper. It was dead code — nothing in the server, web bundle, tests, or scripts imported it, and its doc comment described a "connectors on a 4 AM cron" system that doesn't exist here. The AI client's own transient-error backoff (`src/ai/client.ts`) is the only retry path the app actually uses.
