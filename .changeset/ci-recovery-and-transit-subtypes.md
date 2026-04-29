---
'tripsheet': minor
---

✨ Add Flight / Train / Ground transit type chips. The editor's Type picker now exposes three transit subtypes that all save kind=`transit` and pre-seed an `attributes.transit_mode` discriminator. Train and Ground transit use free-text "From" / "To" strings (station / address) since IATA codes don't apply; flights still use IATA airport codes for time-zone derivation. The structured form lets the user change the mode after creation. Timeline display and PDF parser prompt are mode-aware so a "Eurostar · London → Paris" reads naturally without inventing IATA fields.

🐛 Bring CI back to green:

- Move jest config from `jest.config.ts` to `jest.config.mjs` so the test runner doesn't require `ts-node`.
- Drop `web/src/` from the root `eslint` invocation; that command's `parserOptions.projectService` only sees the root `tsconfig.json`, which doesn't include the SPA. The web bundle is still typechecked at build time by `esbuild`'s loader; root lint stays focused on the server. Existing `format:check` already covers both trees.
- Surface the transit subtypes' `transit_mode` attribute through the existing fields-form rendering instead of new code paths, so backfill, derive(), and normalizeAttrs all keep working with no schema migration.
- Sundry strict-eslint cleanups: deduplicate type imports, drop a stale `String()` conversion, attach `cause` to a config-load `throw new Error`, replace a nested ternary in flight derive() with `if`/`else`, prefer `?.trim()` over `&&` chains, and add an exhaustiveness `default` arm to the suggestion-acceptance switch.
