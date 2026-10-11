---
"@systemfsoftware/stryker-js-instrumenter": major
"@systemfsoftware/stryker-js": major
---

RefinementRemoval is a new default mutator: it drops one refinement from a Schema .check(...) or S.check(...) call per mutant, or the whole call when it holds one refinement, so the schema accepts what it refused. Runs plant more mutants and scores change. Exclude it with mutator.excludedMutations.
