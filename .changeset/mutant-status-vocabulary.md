---
"@systemfsoftware/stryker-js-instrumenter": major
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js": major
---

A mutant's status is declared once, as the eight-value `Mutant.MutantStatus`, plus the named subsets a run partitions on: `Mutant.SurvivorStatus`, `Mutant.RememberedStatus`, `Mutant.EphemeralStatus`, and `Mutant.ActionableStatus`. Import the subset your decision matches instead of re-listing the statuses you accept.

Mutants are tagged structs now. A status reason decodes only together with a status, and the remembered-mutant and ignored-mutant rows carry the same narrowed status as the subset they were selected by.
