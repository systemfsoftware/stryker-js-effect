---
title: The checker RPC conformance scenarios hang on effect 4.1.3 and 4.1.4
date: 2026-11-13
category: test-failures
module: stryker-js
problem_type: test_failure
component: testing_framework
severity: high
applies_when:
  - "Moving the workspace's effect lock past 4.1.2"
symptoms:
  - "tests/checker-rpc.integration.test.ts, tests/mutant-deadline and tests/worker-connection-loss scenarios fail with `Test timed out in 120000ms`"
  - "The same files pass when the lock resolves effect 4.1.2"
root_cause: dependency_behavior_change
resolution_type: dependency_update
tags: [effect, effect-rpc, checker, pnpm-overrides]
---

# The checker RPC conformance scenarios hang on effect 4.1.3 and 4.1.4

## Problem

The e2e harness needs effect-microsandbox 6.1.0, whose effect peer range is
`^4.1.2`. Re-resolving the lock for it took effect 4.1.4. From then on the
checker RPC conformance scenarios, the mutant-deadline scenarios and the
worker-connection-loss scenarios timed out after 120 s.

## What is proven

- A clean clone of main with only the lock moved to effect 4.1.4 reproduces
  the timeouts. The same clone at effect 4.1.2 passes every one of those files.
- 4.1.3 also hangs.
- Between 4.1.2 and 4.1.3, `effect/rpc/RpcServer` changed how it ends a
  client's queue on disconnect and how it dispatches decoded requests.
  `effect/rpc/RpcClient` and `effect/Queue` changed too. Which of these
  changes the worker protocol depends on is not isolated yet.

## Fix

`pnpm-workspace.yaml` overrides pin effect, `@effect/vitest`,
`@effect/opentelemetry`, `@effect/platform-node` and
`@effect/platform-node-shared` at 4.1.2. That is the newest release that
passes the scenarios and the oldest the microVM packages accept. Package
manifests keep their `^4.1.0` ranges.

## Rule

Remove the pin only together with a fix for the hang. The fix is in this
repository's worker protocol or upstream in effect, and the scenarios above
pass on the newer effect.
