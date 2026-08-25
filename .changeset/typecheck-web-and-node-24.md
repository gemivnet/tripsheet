---
'tripsheet': patch
---

Bring `web/` under the linter and the typechecker, and move off EOL Node.

esbuild strips types without checking them and the root tsconfig excluded `web/`, so
8.2k lines shipped unverified. Turning the checks on immediately found two real defects:
`web/src/api.ts` declared an `ItemKind` union missing two of the server's nine kinds
while `shared.tsx` keyed a `Record<ItemKind, …>` on it, and `TripEditor` built a
placeholder `Trip` without the `slug` field a migration had made required.

Two more surfaced from the lint pass. The shared `request()` helper object-spread
`init.headers`, which silently drops anything that is not a plain object, and applied
`...init` afterwards so a caller's headers replaced the merged `content-type` outright.
Deleting a trip used `try/finally` with no `catch`, so a failed delete rejected into
nothing and the card sat there with no explanation.

Adds `yarn typecheck` (both projects) and wires it into CI alongside lint and format.
Rules that fight JSX idiom rather than catch defects are relaxed for `web/` only.

Also bumps the Dockerfile, CI and `engines.node` from Node 20, which is EOL, to 24, and
multer from the deprecated 1.x line to 2.x.
