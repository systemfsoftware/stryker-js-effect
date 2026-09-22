---
title: api-extractor forgotten-export aliases flake between Node and Node_2 across local rebuilds
module: stryker-js toolchain
problem_type: build_error
component: api-extractor / tsdown
tags: [api-extractor, api-report, tsdown, chunk-hashing, ci-divergence]
severity: medium
date: 2026-09-22
---

## Symptoms

`pnpm --filter @systemfsoftware/stryker-js build` (or any package whose emitted `.d.mts` graph inlines the stryker-ignorer-interface types) succeeds locally, but regenerating `etc/stryker-js.api.md` afterwards changes lines that have nothing to do with the edit:

```diff
-// Warning: (ae-forgotten-export) The symbol "Node_2" needs to be exported by the entry point index.d.mts
+// Warning: (ae-forgotten-export) The symbol "Node" needs to be exported by the entry point index.d.mts
```

Committing the locally regenerated report then fails `api:check` in CI, because CI's deterministic build emits the other alias.

## Root cause

The Ignorer node type is inlined into the bundle without being exported, so api-extractor invents a stable name for the forgotten export. The name gets a numeric suffix (`Node_2`) only when another `Node` symbol collides inside the same emitted chunk graph. tsdown chunking is content-hash based and not deterministic across machines (and occasionally across repeated local builds), so the collision appears or disappears per build. `propertyOrder`-style options do not exist for this; it is a declaration-collision artifact, not a schema or source issue.

## Resolution

- Treat `Node` vs `Node_2` in `etc/*.api.md` as **build noise**: when a regeneration diff contains only that alias flip and no signature change, revert the file (`git checkout -- <api.md>`) and keep the alias CI produces (`Node_2` on this repo's CI as of 2026-09).
- Do not chase it by renaming or exporting the ignorer type as part of an unrelated change; exporting it is an API-surface decision of its own.
- A local `api:check` warning after a regen that flips only this alias is expected and pre-existing; the gate that decides mergeability is CI's.

## Prevention

When regenerating api reports, diff them before committing and split "alias flip" hunks from "real signature" hunks. Only the signature hunks belong in the commit.
