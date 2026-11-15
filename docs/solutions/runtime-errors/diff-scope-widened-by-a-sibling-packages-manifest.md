---
title: plan --since widened a monorepo package to a full plan because a sibling package's manifest changed
date: 2026-11-13
category: runtime-errors
module: stryker-js
problem_type: runtime_error
component: cli
severity: high
applies_when:
  - "Changing which changed files widen `run --since` or `plan --since` to a full scope"
  - "Running diff-scoped mutation on one package of a monorepo"
symptoms:
  - "`stryker plan --since <ref>` in a monorepo package records `FullScope` with a reason naming another package's file, such as `manifest or lockfile changed: ../../<another package>/package.json`"
root_cause: logic_error
resolution_type: code_fix
tags: [diff-scope, plan-since, run-since, monorepo, git-diff]
---

# plan --since widened a monorepo package to a full plan because a sibling package's manifest changed

## Problem

`stryker plan --since <ref>` ran in one package of an external pnpm monorepo.
It planned all 823 mutants as `FullScope`. The recorded reason named
`../../<another package>/package.json`, a file the package neither reads nor
depends on.

## Cause

`git-diff.workflow.ts` treated every changed `package.json`, lockfile, Stryker
config or test-runner config as a reason to widen to a full scope. `git diff`
lists the whole repository's changes, so in a monorepo almost every range
contains another package's manifest. Since #287, hunk paths are relative to the
project, so those files show up as `../<sibling>/...`.

## Fix

A changed file widens the scope only when it lies in the project or in one of
its ancestor directories. The workspace root's lockfile and manifest still
count as ancestor files.

The diff command now pins its output format: `--no-color --no-ext-diff
--no-textconv --no-relative --src-prefix=a/ --dst-prefix=b/`. Without that,
`color.ui=always`, `diff.mnemonicPrefix` or `diff.relative` in a user's git
config made `parseHunks` read no files, or the wrong ones, without reporting
anything.

## Still open

A change to the root `pnpm-lock.yaml` still widens every package, even when
that package's own lockfile closure is the same at both ends of the range.
Deciding that needs the base lockfile's closure for the project, compared with
the working tree's.
