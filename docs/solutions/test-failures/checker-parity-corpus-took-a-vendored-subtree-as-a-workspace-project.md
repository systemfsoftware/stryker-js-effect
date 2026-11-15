---
title: The checker-parity corpus took a vendored subtree's tsconfig as a workspace project
date: 2026-11-15
category: test-failures
module: stryker-checker-parity
problem_type: test_failure
component: testing_framework
severity: high
symptoms:
  - "Every push to main failed `checker-parity-changes` at the `plan` step, and `checker-parity-report` then failed for want of the driver's dist/main.mjs"
  - "`plan` reported io-failed: `tsc --listFilesOnly` exited 1 on `repos/alchemy/examples/cloudflare-vue/tsconfig.app.json`"
root_cause: logic_error
tags: [checker-parity, corpus, subtrees, tsconfig]
---

# The checker-parity corpus took a vendored subtree's tsconfig as a workspace project

## Problem

The checker-parity lane builds its corpus from tracked files. It took every tracked path whose file name was `tsconfig.app.json` as a workspace project. A subtree vendored under `repos/` carries its own `tsconfig.app.json` (`repos/alchemy/examples/cloudflare-vue/tsconfig.app.json`). That project's dependencies are not installed in this workspace, so `tsc --listFilesOnly` on it exited 1, `plan` failed with io-failed, and the lane failed on every push to main.

## Root cause

The corpus was decided by file name alone. A file name says nothing about which workspace a project belongs to. Only the package manager knows which directories are workspace packages.

## Fix

The corpus is now the `tsconfig.app.json` at the root of each directory that `pnpm ls -r --depth -1 --json` reports as a workspace package (`test/checker-parity/src/run-side.ts`, `workspacePackageDirectories`; `test/checker-parity/src/corpus.ts`, `corpusEntries`). A tracked file outside those directories is not a project of this repository, whatever its name. pnpm reports real paths, so the repository root is resolved to its real path before the package directories are made relative to it; otherwise a checkout reached through a symlink gets `../` paths and an empty corpus.

Verified on the fixed branch: `plan --deadline 2160 --block-mutants 16` succeeds from both a symlinked and a real working directory, the plan names no path under `repos/`, and every one of the 23 tracked `tsconfig.app.json` outside `repos/` stays in the corpus.

## Prevention

Decide membership of a set of workspace projects from the workspace's own list, never from a path pattern over tracked files. A vendored subtree, an example or a fixture can carry any file name.
