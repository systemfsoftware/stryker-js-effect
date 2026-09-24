---
title: api-extractor forgotten-export aliases flake between Node and Node_2 across local rebuilds
module: stryker-js toolchain
problem_type: build_error
component: api-extractor / tsdown
tags: [api-extractor, api-report, tsdown, chunk-hashing, ci-divergence]
severity: medium
date: 2026-09-22
last_updated: 2026-09-24
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

The alias only exists because the report walks a type the entry point does not export. Exporting that type under its own name removes the invented alias. PR #24 exports `Node` beside `Ignorer` from `@systemfsoftware/stryker-js`, together with the `Framework` type the framework plugins implement. `shouldIgnore(node: Node, ...)` then renders the same way in every build, and the host changeset lists the new exports. The report stayed byte-identical over five forced `turbo run test api:check --force` runs.

Before PR #24 the advice was to revert alias-only flips and keep CI's alias. That still applies to a package that has not exported the type. It stopped working for the host once a second bundled interface (the framework interface re-exports the ignorer AST types) reached the same `Node`. After that the alias rotated between `Node$2` and `Node_2$1` inside a single local turbo run, so there was no stable rendering to keep.

A forgotten export can also name a chunk file: `// dist/<chunk>-<hash>.d.mts:<line>:<col> - (ae-forgotten-export) The symbol "Framework" ...`. The hash changes with any edit to that chunk, so the report breaks on unrelated source changes. Treat it as the same defect and export the named type.

## Prevention

- When an `etc/*.api.md` diff contains a `$N`/`_N`-suffixed forgotten symbol or a hashed `dist/*-<hash>.d.mts` path, export the type the public signature reaches. Do not regenerate the report and hope for a stable alias.
- The oxc `Node` that the exported `Node` alias wraps is still a forgotten export (`Node$1$1`). It has stayed stable so far. If it starts to rotate, the same fix applies.
