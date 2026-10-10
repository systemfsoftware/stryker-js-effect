---
"@systemfsoftware/stryker-js-instrumenter": minor
"@systemfsoftware/stryker-js-plugin-interface": minor
---

A plugin `Mutant` gains an optional `guard` field: `{ block, inside, alternate? }` on a mutant in the condition of an `if` whose consequent is a non-empty block. `block` is the id of the mutant that empties that block, `inside` lists every other mutant inside it, and `alternate` is the id of the mutant that empties the `else` block. An `if` with an `else` that is not a non-empty block carries no guard, so an `else if` chain guards only its last `if`. Under `mutator: { mutantSetPolicy: 'full' }` no mutant carries a guard.

The ignore rule `arid-uncovered-block` joins `IgnoreRuleId`, and `Mutant.uncoveredBlockStatusReason(guard, noCoverage)` builds its status reason.
