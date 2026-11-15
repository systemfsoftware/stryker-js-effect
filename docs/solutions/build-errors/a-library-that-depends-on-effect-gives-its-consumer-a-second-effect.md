---
title: A library that depends on effect gives its consumer a second effect
date: 2026-11-15
category: build-errors
module: stryker-js-cli-contract, stryker-js-plugin-interface, stryker-js-instrumenter, stryker-js-typescript-checker, stryker-js-plugin-runtime
problem_type: build_error
component: package_manifest
severity: high
applies_when:
  - a published package's library entry points import `effect` (or `effect/*`) at runtime
  - a consumer may run a different patch of effect than this workspace pins
---

# A library that depends on effect gives its consumer a second effect

## Symptom

A consumer on effect 4.1.2 imported `ShardPlan` from `@systemfsoftware/stryker-js-cli-contract` 2.0.0 and decoded with its own `Schema`. Its package manager resolved the contract's `effect: ^4.1.0` dependency to 4.1.4, a second copy, and TypeScript refused the schema: `Type 'Objects' is not assignable to type 'AST'`.

## Cause

cli-contract, plugin-interface, instrumenter, typescript-checker and plugin-runtime listed `effect` under `dependencies`. Inside this workspace, the `effect: 4.1.2` override hid that: every package resolved one copy. Outside it, each dependency range resolves on its own.

## Fix

Each package whose published library entry points import effect peers on it (`^4.1.2`, the version built and tested here) and keeps it in `devDependencies` to build. The entry points that start their own process bundle effect 4.1.2 and need no dependency on it: stryker-js's CLI `main.mjs`, the checker's worker `main.mjs`, and the vitest runner's `worker.mjs` and `stryker-setup.mjs`.

How to tell which entry points import effect: in the packed tarball, count top-level `import … from 'effect…'` statements per `dist` file (runtime imports), and `//#region …node_modules/effect/…` markers (bundled modules).

Measured after the change, in a consumer outside the workspace with `effect: 4.1.4` and the packed tarballs: `npm ls effect` shows one copy, 4.1.4. A `ShardPlan` decode type-checks and runs, and the checker's `./runtime` entry loads. The flake's `stryker run` still ends in a verdict, with one effect, 4.1.2, in its tree.
