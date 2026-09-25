---
title: In-memory runner must reuse the host instrumenter namespace
date: 2026-09-20
input_shape: solution
subject: VM sandbox shares host INSTRUMENTER_CONSTANTS.NAMESPACE by identity
applies_when:
  - activating mutants in the in-memory vm test runner
  - mapping checker child-process failures into mutation-test StageError
---

# In-memory runner must reuse the host instrumenter namespace

Instrumented helpers close over `globalThis[INSTRUMENTER_CONSTANTS.NAMESPACE]` at
load. A later sandbox that installs a _different_ object under the same key is
invisible to those closures, so `ACTIVE_MUTANT` never reaches already-required
modules.

## Architectural invariants

**INV-1: Namespace identity, not a copied field.** `hostStrykerNamespace`
returns the existing host object (creating it once). `sandboxFor` puts that
same object on the sandbox. `withActiveMutant` writes `ACTIVE_MUTANT` on it
around `runInContext` and restores afterwards. Rationale: `require()`d
instrumented modules captured the host object; copying the id onto a new bag
does not update them.

**INV-2: CheckerFailed stays CheckerFailed.** `recordCheckerCall` maps
`CheckerFailed` through as itself. Folding it into
`ChildProcessCrashedError` via `{ message: string }` yields an empty crash
because `CheckerFailed.message` is empty; the cause lives on `.cause`.
Rationale: the mutation-test stage must fail with the checker's reason, not a
blank child-process crash.

**INV-3: An empty mutation score is `Unscored`, never NaN or 0.**
`Metrics.mutationScore` and `Metrics.mutationScoreBasedOnCoveredCode` return
`Report.MutationScore`: `Scored { percentage }` or `Unscored` when no mutant
counts toward the denominator. Consumers match on the tag: `Unscored` renders
`n/a`, passes any `thresholds.break`, and encodes as `null` on the wire.
Rationale: 0 is a real score and trips `VerdictFail` whenever
`thresholds.break > 0`; NaN is a number no schema should admit.

## Code smells

- New object assigned to `sandbox[INSTRUMENTER_CONSTANTS.NAMESPACE]` → reuse
  `hostStrykerNamespace()`.
- `Effect.mapError((error) => crashed(error.message))` on a checker call →
  `Match.tag('CheckerFailed', (failed) => failed)`.
- `if (this.totalValid === 0) return 0` on a mutation-score getter →
  `return Number.NaN`.
- E2E expected mutation score computed from the same verdict's `killed` /
  `survived` → pin an authored inventory or drop the tautology.
