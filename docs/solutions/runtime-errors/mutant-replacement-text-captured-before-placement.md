---
title: Print a mutant's replacement before activation placement rewrites it
date: 2026-09-24
category: runtime-errors
problem_type: stale-derived-value
input_shape: solution
subject: replacement text read lazily from the AST reports the placed tree, not the proposal
applies_when:
  - building an ApiMutant from a Mutant record
  - changing where or when a mutator's replacement node is printed
  - adding a mutator whose replacement reuses nodes the placement step also edits
---

# Print a mutant's replacement before activation placement rewrites it

A mutator proposes a replacement node; the placer then rewrites that same AST in
place to wrap the expression in the active-mutant conditional. Printing the
replacement after placement yields the placed tree, so the reported mutant reads
`Ref.set(closed, stryMutAct_9fa48("2") ? false : ...)` where the mutator proposed
`Ref.set(closed, false)`. Every consumer of that string — the API mutant, a
checker payload, a snapshot — is then handed a mutant nobody proposed.

## Problem

Placement and report read the same object at different times:

$$
T_{\text{print}} > T_{\text{place}} \;\Longrightarrow\; \text{reported} = \text{placed} \neq \text{proposed}
$$

The invariant fails only when a mutator's replacement node is reachable through
the mutated node, which is the common case for the Effect-concurrency mutators
(they rewrite the argument expression in place), so the defect is silent for the
whole default mutator set and appears only under an opt-in mutator.

## Architectural invariants

**INV-1: Capture at creation, not at report time.** `createMutant` fills
`Mutant.replacementCode` from `planned.replacementCode`, and `toApiMutant` only
copies it. The value is a `readonly string` on the record.

```
createMutant(planned, fileName, original, replacement)
  └─ replacementCode: planned.replacementCode   # frozen here
toApiMutant(mutant) → { replacement: mutant.replacementCode }
```

Rationale: the record is the last point at which the proposal and the live AST
agree. Deriving the text later re-reads a tree the placer has already rewritten.

**INV-2: A failed print is per-mutant, never per-run.** The proposal is printed
while planning, so one unprintable replacement fails that mutant instead of
aborting the file's whole mutant set.

**INV-3: Placement owns the node it wraps.** The placer may mutate the node it
receives. Any downstream consumer that needs the pre-placement shape must be
served from a value captured before that step, never from the live node.

## Code smells

- `toApiMutant` calling a printer (`print`, `generate`, `sourceOf`) on
  `mutant.replacement` instead of reading `mutant.replacementCode` — the lazy
  form is exactly the regression this document pins.
- A `Mutant` record without a captured text field while some consumer prints
  `replacement` later — add the field; do not re-derive it.
- A new mutator that returns a node it also mutates during placement and expects
  the report to reflect the proposal — it depends on INV-3 holding.
- A test that asserts the replacement string of a mutant whose node was placed,
  with nothing asserting the proposal — the assertion cannot distinguish the
  two, so it passes on both the correct and the broken version.

## Verification

The finalizer-escape mutation integration scenario runs a mutator whose
replacement is placed in the same tree: it fails against a lazily printed
replacement and passes against the captured one. Keep one such scenario per
mutator family that reuses its replacement nodes.
