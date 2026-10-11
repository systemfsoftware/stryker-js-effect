---
"@systemfsoftware/stryker-js-instrumenter": major
"@systemfsoftware/stryker-js": major
---

RecoveryRemoval is a new default mutator: one Effect recovery (catch, catchTag, catchIf, catchFilter, catchReason, orElseSucceed) is dropped per mutant, and catchTags/catchReasons records lose one handler per mutant, so runs plant more mutants and scores change. Exclude it with mutator.excludedMutations.
