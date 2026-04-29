---
'tripsheet': patch
---

🐛 AI chat starter chips now send immediately on click instead of pre-filling the textbox. Also reshape the chat's error path so a failed request tells the user *why* — distinguishes a dropped connection ("couldn't reach the server — is the dev process running?"), a missing `ANTHROPIC_API_KEY` (with the fix instruction), and any other backend error (surfaces the raw message). Server-side, the `/chat` route now logs the full error stack so the next "NetworkError" can actually be debugged.
