---
title: Name placeable mutants by id — a filtered plan slice shifts every later replacement
date: 2026-09-27
category: runtime-errors
problem_type: positional-pairing
input_shape: solution
subject: a subset of a node's mutants ignored by a directive shifts the plan slice paired with the candidate list
applies_when:
  - pairing a plan decision's mutants with the candidate nodes they replace
  - changing MutantsPlanned or any decision that slices its mutants into a placeable subset
  - adding a directive, ignorer, or exclusion that drops some of a node's mutants
---

# Name placeable mutants by id — a filtered plan slice shifts every later replacement

`PlanMutantsCommand` carries one candidate per proposed mutant, and the plan
answers with a `PlannedMutant` per candidate. The transformer paired candidates
with planned mutants **by array position** to mint the node-bearing mutants and
did the same with the plan's slice of placeable mutants. A directive that
silences one mutator of a node removes those entries from the slice but not from
the candidates, so the zip slid: the first placeable mutant took the first
candidate's replacement.

The fixture's threshold comparison `if (level > threshold)` proposes
`[ConditionalExpression true, ConditionalExpression false, EqualityOperator >=,
EqualityOperator <=]`, and `// Stryker disable ConditionalExpression` leaves
`[>=, <=]` placeable. The emitted arms bound `>=` to `true` and `<=` to `false`:

```js
// wrong — each arm runs a sibling's replacement
if (stryMutAct_9fa48("4") ? false : stryMutAct_9fa48("3") ? true : (stryCov_9fa48("3", "4"), level > threshold))
// right — each arm runs its own mutant's replacement
if (stryMutAct_9fa48("4") ? level <= threshold : stryMutAct_9fa48("3") ? level >= threshold : (stryCov_9fa48("3", "4"), level > threshold))
```

Every reader of that binding is wrong in the same direction: the mutant reported
as `EqualityOperator "level >= threshold"` ran `true`, so it was `Killed` where
its authored intent is `Survived`, and the mutants whose replacements leaked were
covered by no arm at all.

## Problem

Two lists derived from one another drift the moment one is filtered:

$$
\text{paired}[i] = \text{candidates}[i] \;\wedge\; \text{planned}_{\text{placeable}} = \text{planned} \ominus \{\text{ignored}\} \;\Longrightarrow\; \text{paired}[i] \neq \text{candidate of planned}_{\text{placeable}}[i]
$$

The failure needs a non-empty ignored _prefix_: silencing a suffix of a node's
mutants leaves the surviving pairs aligned. That is why it survived every
directive that silences a whole node or a trailing mutator, and why its only
fixture sighting was `ConditionalExpression`, which the stock registry proposes
ahead of `EqualityOperator`. Nothing in the types forbade the two lists from
differing in length, so neither the compiler nor a law could catch it; the
mis-bound mutant still reported a status, just not its own.

## Architectural invariants

**INV-1: A filtered subset is never zipped against its unfiltered source.** The
plan names the placeable mutants as `MutantsPlanned.placeableIds`
(`Mutant.MutantId`), not as a second copy of the planned records. `collectPlan`
mints the node-bearing mutants once from `plan.mutants` — one planned mutant per
candidate — and `placeableAmong` selects the mutants to place out of that one
list by the id the plan carries.

```
mutants   = plannedWithNodes(candidates, plan.mutants)     # one per candidate
placeable = placeableAmong(mutants, plan.placeableIds)     # by key, never by index
```

Gate: the differential placement scenario fails when an emitted arm's bound text
is not its mutant's own `replacement`, and the law
`PlaceableIdsNameExactlyTheUnignoredMutants` fails when `placeableIds` names
anything but the planned mutants whose `ignoreReason` is absent.

**INV-2: Plan-to-node binding is by construction, not by a recovered index.**
`planMutantsAt` maps the mutable candidates into the command's `candidates` and
hands those same candidates to `collectPlan`, so `plannedWithNodes` may pair
them positionally. Any pairing across a _different_ list — a filtered slice, a
re-ordered collection, a second plan call — is the defect INV-1 names. Gate:
review — a new pairing site either derives both sides from one list in the same
call or carries a key, and INV-1's gates cover the sites that survive.

**INV-3: Dispatch on a closed plan union is exhaustive.** `collectPlan` matches
`MutantsPlanned` and `MutantsFullyIgnored` with `Match.exhaustive`, so a new
decision variant fails to compile instead of falling into the "nothing to place"
branch. Gate: the type checker, on the match's `Match.exhaustive` call.

## Code smells

- `candidates[index]` (or `planned[index]`) beside any array that has been
  `.filter`ed, `.slice`d, or otherwise reduced from the same source — the two
  index spaces no longer agree; select by a key the record carries.
- A decision that answers "which of these are X" by repeating the records
  instead of naming them (`placeable` beside `mutants`, both
  `S.Array(PlannedMutantSchema)`) — two copies invite a caller to pair one with
  the wrong list; ids cannot be paired in the wrong order silently.
- A plan consumer that re-derives the placeability rule (`ignoreReason ===
  undefined`) instead of consuming the plan's answer — the rule then lives in
  two places and drifts.
- A test that activates mutants only for nodes without directives, or compares
  only status tallies: a swapped replacement keeps the status _shape_ of a run,
  so the defect shows only in the mutant whose verdict changes.

## Verification

Two committed gates fail against the positional pairing and pass against the id
selection: the differential placement scenario above, and the plan law
`PlaceableIdsNameExactlyTheUnignoredMutants`. Both were run red before the fix
and green after (`pnpm --filter @systemfsoftware/stryker-js-instrumenter test`).

Evidence from this fix's probe run of the committed enterprise-monorepo fixture
with the lifecycle config (`slice stryker.config.ts`, 364 mutants): before the
fix the triage reported one mismatch, `Survived -> Killed` for the
`EqualityOperator "level >= threshold"` mutant on `restock` in `inventory.ts`;
after it, all 364 mutants matched with annotated and reported status totals
equal (`killedOrTimeout 213`, `survived 24`, `noCoverage 14`, `compileErrors
110`, `runtimeErrors 1`, `ignored 2`). Reproduce from the lane fixture: pack the
CLI and instrumenter, run the CLI on the fixture, and compare the report against
the fixture's `@stryker-expect` annotations with the e2e core's
`matchAnnotations`.
