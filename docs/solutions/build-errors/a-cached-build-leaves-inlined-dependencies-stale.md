---
title: A cached build left the checker's inlinedDependencies naming a version it does not bundle
date: 2026-11-15
category: build-errors
module: stryker-js-typescript-checker
problem_type: build_error
component: tooling
symptoms:
  - "packages/stryker-js-typescript-checker/package.json said effect 4.1.4 while pnpm-lock.yaml resolves 4.1.2"
  - "a forced build rewrote package.json, and the rewrite rode along into unrelated commits"
root_cause: config_error
resolution_type: config_change
severity: medium
tags: [tsdown, inlined-dependencies, turbo-cache, effect]
---

# A cached build left the checker's inlinedDependencies naming a version it does not bundle

## Problem

The checker's manifest listed `"effect": "4.1.4"` under `inlinedDependencies`. The workspace pins effect to 4.1.2 in `pnpm-workspace.yaml` `overrides`, because 4.1.3 and 4.1.4 deadlock the checker RPC conformance scenarios, and the lockfile resolves 4.1.2. So the published manifest named a version the package does not contain.

Every real build rewrote the file back to 4.1.2, and that rewrite rode along into unrelated branches, once nearly landing as an "effect downgrade".

## Cause

tsdown writes `inlinedDependencies` into the package's own `package.json` as a side effect of `build`. The build task declares only `dist/**` as output. A Turbo cache hit replays `dist/` and leaves `package.json` alone, so the committed value is only as fresh as the last uncached build whose result someone happened to commit. It went stale when the override pinned effect back to 4.1.2.

## Fix

Commit the value a forced build writes: `turbo run build --force`, then commit the manifest. A forced build of every package shows this was the only drifted manifest.

## Prevention

After changing the workspace's `overrides` or catalog for a dependency a package inlines, run `turbo run build --force` for that package and commit its manifest.
