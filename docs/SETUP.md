# tripsheet — setup

Two ways to run the app: **local** (fastest feedback loop, good for building)
or **docker** (closest to production, good for daily use).

---

## Local

Requires Node 20+ and Yarn 4 (Corepack ships it: `corepack enable`).

```sh
yarn install
yarn init:local   # creates .env + config.yaml + data/ on first run
```

Then open `.env` and paste your `ANTHROPIC_API_KEY` (get one from
[console.anthropic.com](https://console.anthropic.com)). Session secret is
already generated.

Open `config.yaml` and edit `allowed_emails:` to include the account you'll
sign up with. Anyone not in the list is rejected at signup — this is the only
gate on who can create accounts.

```sh
yarn dev          # API + web bundle watcher in one terminal
```

Serves on [http://localhost:3000](http://localhost:3000). The API and the
React bundle both watch for changes; saving a file in `src/` restarts the
server, saving one in `web/src/` rebuilds the bundle in place.

### Individual watchers

Sometimes it's useful to split them across terminals:

```sh
yarn dev:api      # just the Express server (tsx watch)
yarn dev:web      # just the esbuild bundle watcher
```

### Running without the AI

`ANTHROPIC_API_KEY` blank → the chat tab returns `503 AI is not configured`.
Everything else (timeline, items, comments, uploads, parse jobs queuing)
still works. The server logs a one-line warning on boot.

---

## Docker

```sh
cp .env.example .env          # paste your keys
cp config.example.yaml config.yaml
docker compose up -d
```

State (SQLite + uploaded PDFs) persists in `./data`, which is bind-mounted
into the container. Bring it down with `docker compose down`; your data
stays on disk.

---

## Where things live

| Path | What |
|---|---|
| `data/tripsheet.db` | SQLite database (git-ignored) |
| `data/uploads/` | Uploaded reference PDFs (git-ignored) |
| `reference_samples/` | Scratch folder for PDFs you drop in locally — never committed |
| `config.yaml` | App config (ports, allowed emails, AI tunables) — git-ignored |
| `.env` | Secrets — git-ignored |

Neither `data/` nor `reference_samples/` is ever staged for commit. Anything
uploaded through the UI is handled by the app the same way whether you're
in local or docker mode.
