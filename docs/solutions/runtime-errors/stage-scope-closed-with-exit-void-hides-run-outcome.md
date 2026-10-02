---
title: A stage scope closed with Exit.void hides the run outcome from every finalizer in it
date: 2026-10-02
category: runtime-errors
module: stryker-js
problem_type: logic_error
component: tooling
symptoms:
  - "`cleanTempDir: true` kept the sandbox after a successful run and `false` deleted it after a failed run"
  - "After the decision was fixed, a failed run with `cleanTempDir: true` still removed its sandbox"
  - A finalizer that reads its exit sees success for a run that failed
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [effect, scope, finalizer, exit, add-finalizer, clean-temp-dir, sandbox, run-environment, layer-build]
---

# A stage scope closed with Exit.void hides the run outcome from every finalizer in it

## Problem

Issue #143: the `.stryker-tmp/sandbox-*` directory ignored how the run ended. Two links of one causal chain had to be fixed. Fixing only the first leaves one of the six (`cleanTempDir` x outcome) cells wrong, and that cell is easy to miss.

## Symptoms

- With the default `cleanTempDir: true`, every successful run left a sandbox behind. With `false`, every run deleted it.
- After the `keepTempDir` decision was corrected, the built CLI still removed the sandbox for `cleanTempDir: true` after a failed dry run (exit 3). The other five cells were right.

## What Didn't Work

- Fixing only the `keepTempDir` workflow. It was necessary but not sufficient. The `TemporaryDirectory` finalizer never received a failure `Exit`, so "keep on failure" could not fire.
- Reasoning that `Layer.build(TemporaryDirectory.layer(...))` in `applyPrepare` registers its cleanup in the outer `Effect.scoped` scope, so the finalizer must already see the run's exit. An independent adversarial reviewer made this exact claim during review, and it is wrong. `Layer.build` takes its `Scope` from the context, and the cells run with the `RunEnvironment.stage` context provided. That context's `Scope.Scope` is the stage scope.

## Mechanism

1. `KeepTempDirCommand` carried a single `failed` field. The sandbox service filled it with the option value (`true`/`false`), and `keepTempDir` read it as the run outcome, so `true` kept every sandbox and `false` removed every one.
2. `RunEnvironment.stage` builds a stage scope and registers `Scope.close(stageScope, Exit.void)` as the parent's finalizer. Every finalizer attached to the stage scope, including the `TemporaryDirectory` finalizer that decides from `Exit.isFailure(exit)`, sees `Exit.void` regardless of the run's real exit.

Either link alone yields a wrong cell. Link 1 makes four cells wrong; with link 1 fixed, link 2 still makes (`true`, failed) wrong.

## Solution

1. `KeepTempDirCommand` takes the option literal (`'always' | false | true`) and the run outcome (`failed`) as independent fields. `keepTempDir` dispatches on the literal: `false` keeps, `'always'` removes, `true` keeps if and only if `failed`.
2. The stage scope closes with the exit of the scope that owns it:

```ts
// before
Effect.gen(function*() {
  const stageScope = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(stageScope, Exit.void))
  return stageScope
})

// after
Effect.gen(function*() {
  const stageScope = yield* Scope.make()
  yield* Effect.addFinalizer((exit) => Scope.close(stageScope, exit))
  return stageScope
})
```

## Why This Works

Invariant: **a child scope closed from a parent finalizer inherits the parent's exit.** A finalizer's `exit` is whatever its owning scope was closed with. Hard-coding `Exit.void` at the stage boundary turned every failed or interrupted run into a success for every stage-scoped finalizer. Forwarding the parent's exit restores the real outcome, and only finalizers that read `exit` change behavior. In this codebase that is only the `TemporaryDirectory` finalizer.

A threshold break is not a failure here. `determineExitCode` returns the exit class as a value, so the scope exits successfully and `cleanTempDir: true` removes the sandbox. That matches "the run completed".

## Prevention

- Code smell to grep for: `Scope.close(<scope>, Exit.void)` inside an `Effect.addFinalizer` callback. Forward the callback's `exit` unless no finalizer in the child can observe the outcome, and say why when you don't.
- Test exit-sensitive cleanup through the published run surface (`Engine.strykerCell`) with a failing and a passing project, not only through the pure decision. The "Keeping or removing the sandbox a mutation run leaves behind" integration feature covers all six cells. Reverting only the stage-scope change fails its "fails with sandbox cleaning set to after success" row.
- Check a scoped-finalizer claim with a run, not by reading `Layer.build` call sites. The scope a layer attaches to comes from the provided context, not from the nearest `Effect.scoped`.

## Related Issues

- GitHub issue #143 (fix pending in the PR that closes it)
- `docs/solutions/tooling-decisions/sandbox-discovery-sees-one-text-for-every-mutant.md` (capture tip for keeping the sandbox)
- `docs/solutions/workflow-issues/exit-codes-through-runtime-teardown.md`
