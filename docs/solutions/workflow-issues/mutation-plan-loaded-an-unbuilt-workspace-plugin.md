---
title: Every nightly Mutation run died in Plan because a stryker config loaded a workspace-linked ignorer that the plan job never built
date: 2026-11-13
category: workflow-issues
module: ci-workflow
problem_type: workflow_issue
component: tooling
severity: high
applies_when:
  - "Adding a project to the Mutation corpus (`PROJECTS` in mutation.yml, `projects` in kill-matrix.yml)"
  - "Adding a job that runs `stryker plan`, `stryker run` or any command that loads a stryker config"
  - "Pointing a stryker config's `ignorers`, `checkers` or `testRunner.plugin` at a package the project's manifest links with `workspace:`"
symptoms:
  - "`plan · shards from the incremental cost record` and `kill-matrix · plan` fail with exit 4 (InternalError): Failed to load plugins"
  - "The log shows `PluginLoadRefusedError` with `reason: { _tag: 'ImportFailed', cause: [Object] }` for `packages/stryker-js-instrumenter/node_modules/@systemfsoftware/stryker-ignorer-effect-schema-declarations/dist/index.mjs`"
  - "The build and shard jobs of the same run succeed, because they run turbo build before loading a config"
root_cause: missing_build_step
resolution_type: workflow_improvement
tags: [mutation-testing, github-actions, stryker, plugin-load, workspace-link, pnpm, turbo]
---

# Every nightly Mutation run died in Plan because a stryker config loaded a workspace-linked ignorer that the plan job never built

## Problem

Every scheduled Mutation run from 2026-10-19 to 2026-11-12 failed in its Plan step
(for example run 43207901251), and the kill-matrix plan failed the same way. The
last green run was 39110047551 on 2026-10-18.

## Cause

The console log elides the cause (`cause: [Object]`). The verdict envelope that
`plan` writes to stdout keeps it:
`ImportFailed → StrykerError "Failed to import module …/dist/index.mjs" → ERR_MODULE_NOT_FOUND`.
The file does not exist.

1. #351 added `packages/stryker-js-instrumenter` to the corpus. Its
   `stryker.config.ts` resolves
   `@systemfsoftware/stryker-ignorer-effect-schema-declarations` with
   `import.meta.resolve`.
2. The instrumenter's manifest links that ignorer with `workspace:^`. Its
   integration test needs the in-repo ignorer, and the ignorer package's
   boundary forbids importing the instrumenter, so the test cannot move there.
   The `.deps` overrides do not apply to workspace links, so the specifier
   resolves to `packages/ignorers/effect-schema-declarations`. Under Node's
   default conditions its `exports` point at `dist/index.mjs`.
3. The plan jobs ran `pnpm install` and then `stryker plan` with no build. Every
   other corpus project takes its ignorers from the released `.deps` tarballs,
   which ship a `dist`, so only the instrumenter's config hit the missing file.

To reproduce on a cold clone: copy `.deps` from `nix build .#stryker-published`,
then run `pnpm install --frozen-lockfile` and
`packages/stryker-js/node_modules/.bin/stryker plan --projects packages/stryker-js-instrumenter --full --out plan.json`.
It exits 4. After `turbo run build --filter=./packages/stryker-js-instrumenter`,
the same command exits 0 and plans 987 mutants across 5 shards.

## Fix

Both plan jobs now build every mutated project with the same turbo filter the
build and shard jobs use, before they load any config. A cold build of the five
corpus projects took 21 s on the workstation.

## Rule

A job that loads a stryker config must first build every workspace package that
the config's plugins resolve to. When a plugin fails to load, read the
`reason.cause` chain in the stdout envelope or `--reportFile`, not the console
warning. See also `mutation-lane-green-while-every-job-failed.md`, which covers
a plugin that resolved to its own package's unbuilt `dist` through
self-reference.
