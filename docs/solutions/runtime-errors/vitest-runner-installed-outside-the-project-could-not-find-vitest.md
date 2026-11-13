---
title: The vitest runner failed to start from the Nix package, because its worker resolved vitest beside itself
date: 2026-11-13
category: runtime-errors
module: stryker-js-vitest-runner
problem_type: runtime_error
component: test-runner
severity: high
applies_when:
  - "Running the CLI and its plugins from an install outside the project (the flake's `stryker` package)"
  - "Changing what a plugin worker borrows from the project (`deps.onlyImport` in a worker's tsdown config)"
symptoms:
  - "`worker exited before it accepted the RPC connection`, caused by `ERR_MODULE_NOT_FOUND: Cannot find package 'vitest' imported from …/stryker-js-vitest-runner/dist/main.mjs`"
root_cause: wrong_resolution_base
resolution_type: code_fix
tags: [vitest-runner, nix, module-resolution, registerHooks, deps-onlyImport]
---

# The vitest runner failed to start from the Nix package, because its worker resolved vitest beside itself

## Problem

The first run of the deployed `stryker` package against a package of an
external pnpm monorepo died in the dry run. The runner's worker exited before it
accepted the RPC connection.

## Cause

The runner worker's bundle keeps `vitest` external (`deps.onlyImport:
['vitest']`), because it must run the project's vitest. Its static
`import … from 'vitest/node'` resolved from the worker file's own location.
That works only when the runner is installed inside the project's
`node_modules`. From a Nix store path, no vitest sits on the walk up, so the
import fails with `ERR_MODULE_NOT_FOUND`.

## Fix

`src/main.ts` is now a bootstrap. It registers a `module.registerHooks`
resolve hook that resolves `vitest` and `vitest/*` from `STRYKER_SANDBOX_DIR`,
then imports `worker.mjs`. The hook has to be in place before the worker
module loads, because a module's static imports link before its body runs.

## Rule

A package a plugin borrows from the project resolves from the project, never
from the plugin's install location. The svelte framework still resolves
`svelte/compiler` from its own location. That works in the e2e fixtures, where
the package lives under the fixture's `node_modules`, but not from a Nix store
path.
