---
title: A linked span opened with useSpan never parented the work it wrapped
date: 2026-11-15
category: logic-errors
module: stryker-js-plugin-runtime
problem_type: logic_error
component: tracing
symptoms:
  - "a plugin worker's asynchronous work has a root span that links to the host span but has no children"
  - "spans the work itself starts, such as a cell's span, land in another trace and are cut off from the run that caused them"
root_cause: logic_error
resolution_type: code_fix
severity: medium
retire_when: "no plugin-runtime helper opens a span with Effect.useSpan around an effect it does not hand the span to"
tags: [tracing, opentelemetry, span-links, effect-tracer, plugin-runtime]
---

# A linked span opened with useSpan never parented the work it wrapped

## Problem

`Trace.withLinkedSpan` is how a plugin worker marks asynchronous work: the work gets a root span that links to the host's span instead of being its child. The span was created, but the wrapped effect did not run under it, so the work's own spans never appeared beneath it.

## Symptoms

- `worker.async` was a root span with the right link and no children.
- Inside the wrapped effect, `Effect.currentSpan` answered the span the RPC handler was already running under, not `worker.async`.
- A test that read the trace id from inside the work and collected that trace found no `worker.async` span: `expected exactly one worker.async span`, `inspected=[]`.

## What Didn't Work

- Recording the trace id by wrapping the Effect tracer and matching the span name. That proved `worker.async` existed, but it bypassed the fault: it watched span creation, not which span the work ran under. It was also hand-rolled span recording, which span tests do not do.

## Solution

`withLinkedSpan` opened the span with `Effect.useSpan(name, options, () => effect)`. In effect 4.1.2, `useSpan` creates the span and ends it when the effect exits, but makes it the parent only for code that calls `withParentSpan` on the span it is handed. The callback ignored that span. `Effect.withSpan(effect, name, options)` is `useSpan` followed by `withParentSpan`, so the helper now calls `withSpan` with the same `root`, `links` and `attributes`.

## Why This Works

A span is a parent only while it is the `Tracer.ParentSpan` service in the fiber's context. `withSpan` provides it for the wrapped effect; `useSpan` leaves that to its callback. With the span provided, every span the work starts, including those `effect-cell-types` records for each cell run, is a descendant of `worker.async` in the linked trace.

## Prevention

- A helper that wraps an effect in a span uses `Effect.withSpan`. `Effect.useSpan` is for code that needs the span value itself and passes it on with `withParentSpan`.
- The propagation test reads the trace id from `Effect.currentSpan` inside the linked work, so it breaks whenever the work stops running under `worker.async`. Reverting the fix makes it fail.

## Related Issues

- `packages/stryker-js/tests/trace-propagation.integration.test.ts`
