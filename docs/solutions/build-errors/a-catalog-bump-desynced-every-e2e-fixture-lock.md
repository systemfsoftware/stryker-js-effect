---
title: A catalog bump desynced every e2e fixture lock, and the bake failed with npm's usage text
date: 2026-11-15
category: build-errors
module: e2e-lane
problem_type: build_error
component: tooling
symptoms:
  - "E2E fails in setup with 'ExitFailure: bake every fixture in the preparation microVM: exited 1' before any test runs"
  - "the bake log shows '[bake] <fixture>: npm ci exited 1' followed by npm's usage text (--allow-git, --allow-remote, ...)"
root_cause: config_error
resolution_type: config_change
severity: high
retire_when: "fixtures install from one lock source, so a catalog change cannot leave a second lock behind"
tags: [e2e, fixtures, npm-ci, package-lock, pnpm-catalog, bake]
---

# A catalog bump desynced every e2e fixture lock, and the bake failed with npm's usage text

## Problem

Every push to `main` on 2026-11-15 failed the E2E lane in setup. The preparation microVM's `npm ci` exited 1 for the first fixture it baked, so no suite ran.

## Symptoms

- `Error: ExitFailure: bake every fixture in the preparation microVM: exited 1`
- `[bake] calc-fixture: npm ci exited 1; if package-lock.json drifted or is missing, run pnpm --filter @systemfsoftware/stryker-e2e fixtures:lock and commit the result`
- npm's usage text in place of an error message.

## What Didn't Work

- Reading the CI log for a npm error code: the usage text buried it, and the only clue was the bake script's own hint.
- Running `npm ci` on the raw fixture: its `package.json` holds `catalog:` ranges, which npm rejects with `EUNSUPPORTEDPROTOCOL`. That is a different error from the one the bake hit, because the harness resolves catalogs before baking.

## Solution

`pnpm --filter @systemfsoftware/stryker-e2e fixtures:lock` regenerated the six stale `package-lock.json` files. Before the fix, the committed locks recorded `effect: ^4.1.0` and `@systemfsoftware/effect-cell-types: ^12.0.0`, while `pnpm-workspace.yaml`'s catalog had moved to `^4.1.2` and `^12.1.4` earlier that day.

After the fix, `npm ci --dry-run` succeeded for all eight fixtures, each run on a copy whose `package.json` had its `catalog:` ranges replaced from `pnpm-workspace.yaml`, as the bake does.

## Why This Works

The bake writes each fixture's manifest with catalog ranges resolved, then runs `npm ci` against the committed lock. `npm ci` refuses a lock whose root dependency ranges differ from the manifest, and reports that as a usage error. A catalog bump changes the resolved manifest without touching the lock, so every fixture that names a bumped package fails. Regenerating the locks brings the recorded ranges back in line.

## Prevention

- After changing `pnpm-workspace.yaml`'s catalog, run `pnpm --filter @systemfsoftware/stryker-e2e fixtures:lock` and commit the locks in the same change.
- The lasting fix is structural: two lock sources (the pnpm catalog and per-fixture npm locks) can always drift. Install fixtures from one source; this record retires when they do.

## Related Issues

- `docs/solutions/build-errors/e2e-bake-resolved-an-npm-alias-edge-from-the-registry.md`
- `docs/solutions/build-errors/e2e-lane-packed-a-subset-of-its-workspace-closure.md`
