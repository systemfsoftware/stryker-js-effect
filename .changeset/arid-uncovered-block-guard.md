---
"@systemfsoftware/stryker-js-instrumenter": minor
"@systemfsoftware/stryker-js-plugin-interface": minor
---

A plugin `Mutant` gains an optional `guard` field: `{ block, inside, alternate? }` on a mutant in the condition of an `if` whose consequent is a non-empty block. `block` is the id of the mutant that empties that block, `inside` lists every other mutant inside it, and `alternate` is the id of the mutant that empties the `else` block. An `if` with an `else` that is not a non-empty block carries no guard, so an `else if` chain guards only its last `if`. Under `mutator: { mutantSetPolicy: 'full' }` no mutant carries a guard.

A guard exists only while a `BlockStatement` mutant for the guarded block is planned in the run. When none is planned — an empty block, a block outside the `mutate` range, or the `BlockStatement` mutator not selected — the `if`'s condition mutants run unguarded, and the same holds when no `BlockStatement` mutant is planned for the `else`. An `excludedMutations` entry or a disable directive over the block leaves its `BlockStatement` mutant in the run as Ignored, so it still witnesses the guard.

The ignore rule `arid-uncovered-block` joins `IgnoreRuleId`, and `Mutant.uncoveredBlockStatusReason(guard, noCoverage)` builds its status reason.
