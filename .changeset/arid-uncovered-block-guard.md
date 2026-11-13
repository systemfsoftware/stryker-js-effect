---
"@systemfsoftware/stryker-js-instrumenter": minor
"@systemfsoftware/stryker-js-plugin-interface": minor
---

A plugin `Mutant` gains an optional `guard` — `{ block, inside, alternate? }` — on a mutant in the condition of an `if` whose consequent is a non-empty block. `block` names the mutant that empties the block, `inside` the mutants inside it, `alternate` the mutant that empties the `else`. An `else if` chain guards only its last `if`; `mutator: { mutantSetPolicy: 'full' }` carries no guard.

A guard exists only while a `BlockStatement` mutant for the guarded block is planned. With none planned — empty block, block outside `mutate`, mutator unselected — the condition mutants run unguarded, as when none is planned for the `else`. A `BlockStatement` mutant left Ignored by `excludedMutations` or a disable directive records no coverage, so it never witnesses its guard.

`arid-uncovered-block` joins `IgnoreRuleId`; `Mutant.uncoveredBlockStatusReason(guard, noCoverage)` builds its status reason.
