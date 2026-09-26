---
title: Do not bail agent test runs at the first failure
date: 2026-09-25
category: test-failures
module: stryker-js-family
problem_type: test_failure
component: testing_framework
severity: high
symptoms:
  - "`pnpm test` or `pnpm check:ci` run by an agent never returns and ends only at the caller's timeout"
  - "The same failure run in CI (no AGENT variable) exits promptly with a normal failure summary"
root_cause: config_error
resolution_type: config_change
tags: [vitest, bail, agent, hang, vm-parity, check-ci]
---

# Do not bail agent test runs at the first failure

## Problem

`sharedConfig` in `@systemfsoftware/vitest-config` used to add `bail: 1` when the `AGENT` environment variable was set, so that agents got fast feedback. After one failing test Vitest cancelled the run, and the cancelled run then waited on the fork worker of the vm parity differential suite in `@systemfsoftware/stryker-js`, which never finished. A single failing assertion turned `pnpm test`, and `pnpm check:ci` that runs it, into a hang. One session lost 40 minutes to a 2400 s timeout this way. CI never sets `AGENT`, so it never showed the hang.

## Solution

The agent-only `bail` was removed on the vm-runner redesign branch (PR #111), so agent runs finish and report every failure the way CI runs do. `silent: 'passed-only'` still keeps agent output short.

## Prevention

- Keep agent and CI test settings the same for anything that changes when a run ends (`bail`, `teardownTimeout`, pool options). An option that exists only for agents is not exercised in CI, so nothing catches it hanging.
- Run the Definition-of-Done checks as one `pnpm check:ci` with a timeout of about 25 minutes. It already runs format, lint, typecheck, every test suite and the build. Running `pnpm test` and `pnpm check:ci` back to back runs the suites twice.
- A local `pnpm format:check` also checks git-excluded scratch such as `.context/`, so move scratch out of the tree before trusting that result.
