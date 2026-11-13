---
title: Every e2e leg failed after the effect 4.1.0 bump, because the registry's newest effect-microsandbox imports effect/Crypto
date: 2026-11-13
category: build-errors
module: e2e
problem_type: build_error
component: tooling
severity: high
applies_when:
  - "Moving effect to a new minor in this workspace"
  - "Choosing where an @systemfsoftware package the workspace depends on comes from"
symptoms:
  - "Every leg of the E2E workflow fails at harness load with ERR_MODULE_NOT_FOUND for node_modules/effect/dist/Crypto.js, imported from @systemfsoftware/effect-microsandbox/dist/mod.mjs"
  - "E2E has been red on main since c661be3d (#359, effect 4.1.0), first in run 40973563611"
root_cause: dependency_incompatibility
resolution_type: dependency_update
tags: [e2e, effect, effect-microsandbox, nix, producer-tarballs, pnpm-overrides]
---

# Every e2e leg failed after the effect 4.1.0 bump, because the registry's newest effect-microsandbox imports effect/Crypto

## Problem

#359 moved the workspace to effect 4.1.0. From that commit on, every E2E leg on
main failed before any test ran. The last green run was 39163499227 on
2026-10-18.

## Cause

effect 4.1.0 removed the `effect/Crypto` module. The workspace took
`@systemfsoftware/effect-microsandbox` from the npm registry, where the newest
release is 5.0.0, and that release imports `effect/Crypto`. Releases 6.0.0 and
later use `effect/crypto/SecureRandom` instead. They are published only as
Nix outputs of `systemfsoftware/effect-microvm`, never to a registry.

Release 6.1.0 also needs `@systemfsoftware/effect-readiness` ^1.1.1 and
`@systemfsoftware/effect-cell-types` ^12.0.2. The registry's newest are 1.0.0
and 12.0.0.

## Fix

- The flake now takes effect-microvm (6.1.0), effect-readiness (1.1.2) and
  systemfsoftware (effect-cell-types 12.1.2) as producers, so their tarballs
  land in `.deps` beside the stryker ones.
- `test/e2e` names the three tarballs as `file:../../.deps/<name>.tgz`.
- The lockfile resolves effect 4.1.4, which satisfies their `^4.1.2` peer
  range.

## Rule

A pnpm 11 `overrides` entry does not reach a workspace package's own
dependencies, only packages outside the workspace. A catalog entry cannot use
`file:`. A workspace package that needs a producer tarball therefore names the
`file:` path in its own manifest, as the dogfood devDependencies already do.
When effect moves to a new minor, check that every @systemfsoftware dependency
has a release built against that minor. The registry copy may be stale,
because new releases ship only as Nix outputs.
