# tripsheet

A self-hosted itinerary editor for people who treat trip plans as a **reference resource**, not a rigid schedule.

An itinerary in tripsheet lists your reservations, check-in / check-out times, venue hours, and a slate of candidate activities per day — the kind of document you'd actually want to open while you're standing on a sidewalk deciding what to do next. A right-hand AI panel uses Claude (with web search + extended thinking) to research the current trip against your stated goals and past travel, then proposes discrete, atomic suggestions. Each suggestion arrives as a swipeable card: accept or reject per-card, then iterate.

Designed to run on your home network in a single Docker container. Two logins share one workspace with a full change log so household members can collaborate without stepping on each other.

## What it does

- **Per-trip editor** — trips, days, and items (reservations, check-in / check-out anchors, activities, options, notes, transit). Drag-reorder items within a day, move items between days.
- **AI research panel** — gather the trip context, upload past itineraries and journals, click *Research & suggest*. Claude runs with live web search and extended thinking, emits N atomic suggestions, each with a rationale and citations. Swipe accept / reject per card.
- **Reference library** — upload past-itinerary PDFs and travel journals; Claude parses them into structured records that feed future suggestion runs.
- **Multi-user, shared workspace** — both logins see the same trips. Every mutation is attributed in an activity feed. Per-item comments let you debate a pick without clobbering it.

## Quick start

```bash
git clone git@github.com:gemivnet/tripsheet.git
cd tripsheet
cp config.example.yaml config.yaml       # list the emails allowed to sign up
cp .env.example .env                      # add ANTHROPIC_API_KEY and a SESSION_SECRET
docker compose up -d
open http://localhost:3000
```

See [docs/SETUP.md](docs/SETUP.md) for full setup details, including how to generate a session secret and where uploaded PDFs are stored.

## Architecture

- **Backend**: Node 20 + TypeScript (ESM), Express 5, `better-sqlite3`, Anthropic SDK.
- **Frontend**: React 19 SPA bundled with esbuild.
- **Persistence**: one SQLite file at `data/tripsheet.db`; uploaded PDFs in `data/uploads/`. Both live in a single volume — back up the `data/` folder to back up the whole app.
- **Auth**: `argon2id` password hashing + signed session cookies via `cookie-session`. Signup is gated by an allowlist in `config.yaml`.
- **AI**: Claude Sonnet with the `web_search` tool and extended thinking. System prompt enforces atomic, cited, independently-acceptable suggestions.

## Development

```bash
yarn install
yarn migrate       # create data/tripsheet.db and apply migrations
yarn dev           # backend with tsx watch + web server
yarn dev:web       # alternative: run the web bundler only
yarn test
yarn lint
```

This project uses **Yarn 4** (Berry) with the `node-modules` linker — do not use npm or pnpm.

See [CLAUDE.md](CLAUDE.md) for repo conventions (gitmoji commits, changesets required on `src/` changes, strict PII rules).

## License

[AGPL-3.0-only](LICENSE).
