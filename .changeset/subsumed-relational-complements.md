---
"@systemfsoftware/stryker-js-instrumenter": minor
"@systemfsoftware/stryker-js-plugin-interface": minor
---

Under the default `mutator.mutantSetPolicy`, a relational comparison no longer runs its complement when the matching ordering mutant is kept: for `a < b`, `a >= b` is Ignored because every test that kills `a <= b` also kills it (likewise `>` for `<=`, `<=` for `>`, `<` for `>=`). This holds for every JavaScript operand, `NaN`, `BigInt`, strings, and `valueOf` side effects included. Its status reason reads `redundant-relational: subsumed by <dominator id> (complement): ...` and says what to do next.

A plugin `Mutant` gains an optional `subsumption` field: `{ _tag: 'Subsumed', rule, dominators }` on an `Ignored` mutant, or `{ _tag: 'Readmitted', rule, causes }` on one that ran. A `Mutant` whose `subsumption` disagrees with its status does not decode. Set `mutator: { mutantSetPolicy: 'full' }` to run every complement.
