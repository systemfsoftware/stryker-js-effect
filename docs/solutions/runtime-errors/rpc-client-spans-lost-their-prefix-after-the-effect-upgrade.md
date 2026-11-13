---
title: The worker RPC client spans lost their RpcClient prefix when effect moved past 4.0.0
date: 2026-11-13
category: runtime-errors
module: stryker-js
problem_type: runtime_error
component: telemetry
severity: medium
applies_when:
  - "Moving effect to a new release"
  - "Reading a span the taxonomy (`SpanTaxonomy.Spans.rpcClient*`) declares"
symptoms:
  - "The e2e lifecycle trace contract breaks with `break exists(RpcClient.check) inspected=[]` and `no RpcClient.check span was emitted`"
  - "The trace holds `check`, `dryRun` and `mutantRun` client spans with no prefix"
root_cause: dependency_behavior_change
resolution_type: code_fix
tags: [telemetry, effect-rpc, span-taxonomy, e2e]
---

# The worker RPC client spans lost their RpcClient prefix when effect moved past 4.0.0

## Cause

`worker-client.blueprint.ts` built its client with `RpcClient.make(params.rpcs)`.
In effect 4.0.0, `RpcClient.make` defaulted `spanPrefix` to `"RpcClient"`, so
each call was traced as `RpcClient.<method>`, and the span taxonomy declares
those names. Later releases leave the prefix unset and name the span after the
method alone. After the upgrade, no `RpcClient.*` span was emitted.

## Fix

The client passes `spanPrefix: 'RpcClient'` explicitly.

## Rule

A span name the taxonomy declares must not rest on a library default. Set the
naming option in our code.
