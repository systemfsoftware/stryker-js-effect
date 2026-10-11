---
"@systemfsoftware/stryker-js-instrumenter": major
"@systemfsoftware/stryker-js": major
---

RefinementBoundary is a new default mutator: it moves a Schema bound by one inclusivity step (isGreaterThan and isGreaterThanOrEqualTo swap, as do isLessThan and isLessThanOrEqualTo; isBetween toggles one exclusivity flag per mutant; isMinLength(n) becomes n + 1 and isMaxLength(n) becomes n - 1). Runs plant more mutants and scores change. Exclude it with mutator.excludedMutations.
