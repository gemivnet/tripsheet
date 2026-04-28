# CLAUDE.md — Codebase Instructions

These instructions apply to all work on this repository.

## Product Principles

These shape every feature decision. When in doubt, return here.

- **Make it easier for the user.** Every feature exists to reduce work for the user — fewer clicks, less typing, less remembering. If a change adds steps without removing more, rethink it. The two levers we lean on are **memory** (the app already knows X, so don't ask again) and **AI assistance** (the app figures X out, so the user doesn't have to). New features should improve one or both.
- **Retroactive by default.** New features must apply to *existing* trips, items, and reference docs — not just things created after the change ships. Schema migrations alone aren't enough; if a feature derives, classifies, links, or enriches data, ship a backfill task that runs over historical rows. Pattern: a one-off script in `scripts/backfill-<feature>.ts` (or an idempotent migration step) that the operator can run, plus a boot-time check that detects un-backfilled rows and either auto-runs or surfaces a clear "run this" message. Backfills must be **idempotent** and **resumable** — safe to re-run, safe to interrupt.
- **Every trip is a new trip. Do not get stuck in a rut.** The goal is never to recreate a previous trip. The user's preferences shift over time — what they loved last year might bore them this year. Memory and reference docs are *priors*, not templates. AI suggestions must actively introduce **new things** alongside things the user is known to like — new neighborhoods, new cuisines, new activity types, new pacing. Repeating past picks is a failure mode. Treat the most recent signals (recent journals, recent edits, the current trip's stated goals) as higher-weight than older ones. Never auto-copy items from one trip to another. When generating suggestions, explicitly reserve a portion of each batch for novelty — items that don't appear in the user's history but plausibly fit their current direction.

## 🔒 NO PII IN THE REPO — CRITICAL

This repo is a **self-hosted itinerary editor**. It ingests trip plans, reservations, confirmation codes, fellow-traveler names, uploaded travel journals, and live location/date data. That is exactly the kind of data that must never leak into anything checked into git — this file included.

**Never commit any of the following, anywhere — source, configs, examples, comments, JSDoc, test fixtures, commit messages, changesets, PR descriptions, or this CLAUDE.md itself:**

- Real personal names (first, last, nicknames) — not the user's, not household members', not friends, not fellow travelers mentioned in journals
- Real email addresses (the user's, household members', contacts')
- Real destinations, cities, neighborhoods, coordinates, addresses
- Real travel dates tied to the user
- Real confirmation codes, booking references, reservation numbers, loyalty numbers, frequent-flyer IDs
- Real lodging / airline / tour-operator / restaurant names tied to the user's actual trips
- Real prices, currencies, or dollar amounts from actual reservations
- URLs that contain booking tokens, session IDs, confirmation codes, or user-specific paths
- Verbatim passages from uploaded travel journals (paraphrase *structurally* in commits and docs)
- The specific trip goals or themes the user is personally pursuing (treat any example as hypothetical)
- Employer names, school names, or any identifier that narrows the user's identity

**The hard rule:** every committed file must be **generic enough to share with a stranger on the internet**. If a stranger could read it and learn one specific non-public thing about the real user or their travel, it's PII — rewrite or remove it. **This policy file itself must obey its own rules** — do not cite real PII as "bad examples" here; use hypothetical placeholders only.

### How to write about real incidents without leaking PII

When describing a bug that surfaced in the user's live data, describe the bug **structurally**, never by the concrete data.

Hypothetical illustrations (fabricated, not from any real session):

- ❌ "Fixed timezone offset on Tuesday's <named-flight> reservation"
- ✅ "Fixed off-by-one timezone offset on reservation items"

- ❌ "Swipe suggestion repeated <specific-activity-at-specific-city> twice"
- ✅ "Duplicate suggestion emitted when two reference docs overlapped"

- ❌ "PDF parse dropped the day-3 entry for <named-restaurant>"
- ✅ "PDF parse dropped entries when the source used a non-ASCII bullet"

- ❌ "Added check-out time for <named-lodging>"
- ✅ "Added check-out time field to the reservation item kind"

### Sample configs and examples

`config.example.yaml`, JSDoc examples, test fixtures, README snippets:

- Use **generic placeholders**: `"Your City, ST"`, `"Destination A"`, `"Person 1"`, `"Partner"`, `test@example.com`, `shared@example.com`
- For trip examples, pick neutral fictional destinations (Springfield, Metropolis) — never mirror the user's actual plans
- For lodging/dining examples, don't use real brands — say "a hotel," "a restaurant," "a museum"
- For journal examples, write obviously-fictional filler ("Day 1: arrived, settled in, walked the old quarter.")
- Never copy values from the user's real `config.yaml` or uploaded PDFs into committed fixtures

### Changesets

Changesets ship to the public `CHANGELOG.md` on every release. Treat every changeset as public documentation:

- Describe what the code change does, not what user data triggered it
- Use hypothetical or structural examples, never real ones from the user's dataset
- If you find yourself writing "e.g. labeling X as Y" where X/Y came from their actual trip or journal, rewrite it

### Commit messages

Same rules as changesets — they're on the public git history forever. `git log` on this repo is public once pushed. Never include:

- Specific destinations, dates, lodging / airline / restaurant names, confirmation codes
- Specific goals, themes, or journal excerpts that prompted the fix
- The user's real name, email, partner's name, or any direct identifier

### Memory files

The files under `~/.claude/projects/.../memory/` are **your** context — they can contain real user data, that's their purpose. **None of that leaves the memory directory.** When writing commits, changesets, code, docs, or this CLAUDE.md, pretend the memory context doesn't exist.

### Local data folders

`data/` (holds `tripsheet.db` and uploaded PDFs) and `reference_samples/` (the user's scratch folder for sample journals) are both git-ignored. Never stage anything from those paths. The database file itself contains PII by design — it must never land in a commit, a test fixture, or a `--show-*` script's output committed to the repo.

### Pre-push self-audit

Before every `git push`, scan the staged/outgoing diff + commit messages against the PII terms you currently hold in memory:

```
git log origin/main..HEAD --format="%B" -p | grep -iE "<pattern built from current in-memory PII terms>"
```

If anything matches, stop and rewrite. Do not build the pattern into this file — it is itself committed.

**If you realize PII already landed in a pushed commit**, immediately: (1) create a backup branch, (2) `git reset --hard` to before the bad commit, (3) rebuild the commits with the PII scrubbed, (4) force-push. The user has explicitly authorized rewriting git history for PII cleanup — do it without asking.

## Commit Style

- **Always use gitmoji prefixes** on commit messages (e.g. `🧪 Add tests`, `🐛 Fix bug`, `📦 Add dependency`)
- Common gitmojis: 🐛 bug fix, ✨ new feature, 🧪 tests, 📝 docs, 🔧 config, 📦 deps, 🚀 deploy, ♻️ refactor, 🧹 cleanup, 💄 UI/style, 🔒 security, ⬆️ upgrade, 🏗️ architecture
- Commit and push each individual change immediately — don't batch multiple changes into one commit

## Changesets

Every commit that changes source code (`src/`) **must** include a changeset file. Run `yarn changeset` before committing.

Versioning follows **strict semver**:
- **MAJOR** — breaking changes (API changes, config format changes, DB schema migrations that require manual action, removed features)
- **MINOR** — new features (new item kinds, new AI capabilities, new routes)
- **PATCH** — bug fixes, dependency updates, refactoring, config tweaks, anything that isn't a new feature

DB migrations that apply automatically on boot and don't require user action are **MINOR**; migrations that require the operator to back up or run a one-off script are **MAJOR**.

To cut a stable release: `yarn release` (runs `changeset version`), then commit and push the version bump.

## Documentation

This project must be **thoroughly documented**. When making changes:
- Update the README.md if user-facing behavior changes
- Update relevant docs in `docs/` if API routes, DB schema, setup steps, or architecture change
- Add JSDoc comments to new exported functions
- Keep inline code comments meaningful — explain *why*, not *what*

## Testing

- **Always write and update tests** when changing code in `src/`
- Tests live in `test/` mirroring the `src/` structure
- Run tests: `yarn test` (requires 4GB heap due to ts-jest + ESM)
- Jest + ts-jest with ESM mode (`--experimental-vm-modules`)
- Mock external APIs (Anthropic, fetch) — never make real API calls in tests
- DB tests use an in-memory SQLite database (`better-sqlite3` with `:memory:`) — never the real `data/tripsheet.db`
- Target: 95%+ line coverage

## Project Structure

- `src/` — TypeScript backend (ESM, NodeNext module resolution)
- `src/db/` — better-sqlite3 wrapper + migration runner + schema SQL
- `src/auth/` — signup / login / session middleware (argon2 + cookie-session)
- `src/routes/` — Express route handlers, one file per resource
- `src/ai/` — Anthropic SDK wrappers (research suggestions + PDF parsing)
- `src/prompts/` — Claude system prompts
- `web/src/` — React SPA (esbuild bundled)
- `test/` — Jest tests mirroring `src/`
- `data/` — runtime state (SQLite + uploaded PDFs); git-ignored
- `.changeset/` — pending changesets for next release

## Package Manager

This project uses **Yarn 4** (Berry) with the `node-modules` linker. Do not use npm or pnpm.

## Workflows

- **CI/CD** (`ci.yml`) — single unified pipeline on every push to main: lint → test → release. The release job only runs if lint and test pass. Preview builds per commit, stable on version bump.

## Key Patterns

- Every mutating route writes a row to `audit_log` in the same transaction as the main change. No mutation is allowed without attribution.
- AI suggestions must be **atomic and independently acceptable** — a single card represents one discrete change, never a bundle. The Tinder-style UX depends on this.
- Accepted suggestions apply their `payload_json` diff inside a `db.transaction(...)` (better-sqlite3) so partial application is impossible.
- PDF parsing is a background task; routes return immediately with a `parsed_summary=NULL` placeholder and the UI polls until complete.
- The user commits directly to main — no PRs, no branches.
