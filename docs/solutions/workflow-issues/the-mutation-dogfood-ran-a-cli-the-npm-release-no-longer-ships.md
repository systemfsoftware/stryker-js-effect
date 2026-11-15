---
title: The mutation dogfood ran a CLI the npm release no longer ships
date: 2026-11-15
category: workflow-issues
module: mutation-workflow
problem_type: workflow_issue
component: development_workflow
symptoms:
  - "Mutation (schedule) failed at the plan job with exit 127: packages/stryker-js/node_modules/.bin/stryker: No such file or directory"
  - "The kill-matrix lane failed the same way, so drop-audit found no kill-matrix artifact"
root_cause: config_error
resolution_type: workflow_fix
severity: high
tags: [mutation, kill-matrix, dogfood, nix, flake]
---

## Problem

`mutation.yml` and `kill-matrix.yml` ran `PUBLISHED_CLI`, the bin of the dogfood devDependency
`@systemfsoftware/stryker-js` in `packages/stryker-js/node_modules/.bin/stryker`. Since #384 the CLI ships only as the
flake package (`.#stryker`), and the npm release carries no bin. Once #400 took the dogfood from npm, the path was
gone and every scheduled run failed at its first CLI call.

## Fix

The `released-stryker` action reads the version the lockfile installed, builds the flake package at that release's
tag (`github:<repo>?ref=refs/tags/@systemfsoftware/stryker-js@v<version>#stryker`; the ref needs `?ref=` because the
tag holds `@` and `/`), and exports its CLI as `PUBLISHED_CLI` through `GITHUB_ENV`. Every job that calls the CLI runs
it after `pnpm install`. The workflow-level `PUBLISHED_CLI` is gone: a workflow, job or step `env` would shadow
`GITHUB_ENV`.

The dogfood still runs a released CLI, not the commit under test, and the version still comes only from the lockfile.

The 22.0.0 closure (396 MiB) is not on the binary cache: the cache push at that tag built `stryker-published`, an
output since renamed. Main's cache push now builds `stryker` for every main commit, release commits included.
