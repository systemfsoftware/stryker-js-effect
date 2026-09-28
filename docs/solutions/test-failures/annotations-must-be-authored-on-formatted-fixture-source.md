---
title: Author mutant annotations on the formatted fixture source
date: 2026-09-27
category: test-failures
problem_type: annotation scope invalidated by commit-time formatting
input_shape: solution
subject: The commit hook reflows fixture source and moves the mutated node to another line, so a next-line annotation that matched before the commit no longer claims its mutant
applies_when:
  - authoring or moving a `// @stryker-expect` annotation in a lane fixture or the in-process annotated sample
  - adding fixture source whose declarations exceed the formatter's line width
  - a placement check or lane run passed before a commit and fails after it with "no annotation covers the <Mutator> mutant"
---

# Author mutant annotations on the formatted fixture source

## Problem

A `next-line` annotation claims the mutants whose location starts on the line
after its marker. The repository formatter (dprint, run by lint-staged at
commit) formats fixture sources; only the typescript-checker package's own
test resources are excluded. An untracked annotated sample passed the
in-process placement check as one-line declarations and was committed
reflowed:

```ts
// @stryker-expect next-line KilledOrTimeout: SynchronizationRemoval, ArrowFunction
const guarded = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>): Effect.Effect<number> =>
  Semaphore.withPermits(sem, 1, effect)
```

The `ArrowFunction` mutant still starts on the marked line; the
`SynchronizationRemoval` mutant on the `withPermits` call now starts one line
lower. The placement check refused with
"no annotation covers the SynchronizationRemoval mutant" at the call's position,
and every closure scenario reading the same sample went red with it.

## Failure mechanism

1. A mutant's claim is keyed on its start line; `next-line` resolves to
   `markerLine + 1` (skipping stacked markers).
2. Formatting is a line-count-changing transform applied after authoring:
   a declaration longer than the line width splits at `=>`, moving the body's
   nodes to `markerLine + 2`.
3. The placement check and the lane read the committed bytes; the author's run
   read the pre-hook bytes. Both gates were green on a tree that was never
   committed.

## Architectural Invariants

- **Claims are authored on the canonical layout.** The formatted source is the
  only layout a gate ever reads from the repository, so annotation scope is
  decided after formatting, never before.
- **One marker per start line.** Each line where a claimed mutant starts has
  its own marker directly above it; a reflowed arrow body gets a stacked marker
  inside the arrow:

```ts
// @stryker-expect next-line KilledOrTimeout: ArrowFunction
const guarded = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>): Effect.Effect<number> =>
  // @stryker-expect next-line KilledOrTimeout: SynchronizationRemoval
  Semaphore.withPermits(sem, 1, effect)
```

- **Do not exempt fixtures from formatting to preserve a layout.** The
  annotation's scope is part of the fixture's authored intent; a layout that
  survives only while formatting is off breaks on the next hand edit.

## Verification

- Format the fixture (`./bin/dprint fmt <files>`) before running the in-process
  placement check or the lane; a green run on unformatted source is not
  evidence for the committed tree.
- Code smell: a fixture file that is untracked or unformatted while a placement
  or lane run is cited as its evidence.
