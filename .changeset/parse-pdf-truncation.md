---
'tripsheet': patch
---

🐛 Make PDF parsing resilient to model output truncation. Raise `max_tokens` to the per-model ceiling (32k for Opus, the cap for that family), explicitly check `stop_reason === 'max_tokens'` and surface a clear error instead of an opaque `JSON.parse` failure, and persist the raw model output to `data/parse-failures/<doc-id>-<timestamp>.txt` whenever the response can't be parsed. Operators can now recover from a failed parse without re-spending input tokens on the source PDF.
