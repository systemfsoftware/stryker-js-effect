---
title: A lint-forced dual over an optional trailing parameter misroutes the data-last call
date: 2026-09-24
category: runtime-errors
module: stryker-vm-harness
problem_type: logic_error
component: tooling
symptoms:
  - "A documented data-last call such as `guardedExpect(createExpect)(real)` type-checks, then wraps the wrong argument and returns a proxy that never tags assertions with the running test"
  - "`formatEachName(row, options)` in a pipe is read as data-first, so the row becomes the template"
  - "Every in-repo caller uses the data-first form, so suites stay green and nothing flags the data-last path"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [effect, dual, pipeable, effecttsgo, missing-pipeable-signature, oxlint, public-api, arity]
---

# A lint-forced dual over an optional trailing parameter misroutes the data-last call

## Problem

The effecttsgo `missing-pipeable-signature` rule demands a pipeable overload for an exported function with two or more parameters. When the last parameter is optional, the natural fix is `dual((args) => args.length >= N, impl)`. That makes the data-first and data-last forms share an argument count, so one of them is misread at runtime. Everything still type-checks, because the overload set is declared by hand over the same implementation.

This happened twice in `@systemfsoftware/stryker-vm-harness` during the zero-lint pass (vm-vitest-parity branch):

- `Assertions.guardedExpect(real, createExpect?)` with `args.length >= 1`. A one-argument data-last call `guardedExpect(createExpect)` took the data-first branch. Both arguments are functions, so no runtime check can tell them apart.
- `Registry.formatEachName(template, row, options?)` with `args.length >= 2`. A two-argument data-last call `formatEachName(row, options)` took the data-first branch.

## What Didn't Work

- Making the trailing parameter required (`X | undefined`) and switching to `dual(N, ...)`. The arity becomes unambiguous, but released one-argument callers such as `guardedExpect(real)` from 2.0.0 now get the curried function back instead of a proxy. That is a silent break of a published call shape.
- A `typeof` or shape predicate on the first argument. It fails when both candidates for that slot have the same runtime type (`expect` and `createExpect` are both callable), or when the data-last first argument (`row: EachValue`) can be any value, a string included.

## Solution

Keep every released call shape, and give each dual exactly one reading per argument count:

- **The optional argument changes what the function does:** split it. `guardedExpect(real)` stays the released one-parameter function (no dual needed). The `createExpect` behaviour moves to a new export whose two parameters are both required: `dispatchingExpect = dual(2, (real, createExpect) => ...)`.
- **The optional argument only tunes the result:** remove it from the data-last overload. The pipeable form of `formatEachName` is `(row) => (template) => string`. The data-first form keeps options optional through a rest tuple, `(template, row, ...options: readonly [] | readonly [EachNameOptions])`. A plain `options?` parameter makes the lint rule demand the ambiguous `(row, options?)` overload again, and the rest tuple does not.

Audit every other `= dual(` site in the package with the same question: can the data-first and data-last forms ever be called with the same argument count? Structural predicates such as `startsWithSessionOptions` (a schema guard on the first argument) are fine when the two first arguments have disjoint runtime shapes.

## Why This Works

`dual` chooses the branch only from the arguments it receives at runtime. The branch is unambiguous exactly when the data-first argument counts and the data-last argument counts don't overlap, or when a predicate separates them by a runtime shape that only one side can have. The hand-written overload set does not constrain the choice, so the compiler cannot catch a predicate that disagrees with it.

## Prevention

- When a lint rule demands a pipeable form, first ask whether the optional parameter should be in the pipeable form at all. Usually it should not.
- Before accepting any dual with an `args.length` predicate, list the argument counts each overload accepts. Any shared count is a bug.
- Pin the data-last form in a test whenever the export is public. In-repo callers almost always use data-first, so without such a test nothing exercises the misrouted branch.
- Diff the public signatures against the released version (`git show origin/main:<file>`) before changing an arity. The API report lists names, not parameter counts.

## Related Issues

- `docs/solutions/runtime-errors/host-instrumenter-namespace-identity.md` (same harness, other runtime invariants)
