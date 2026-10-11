---
"@systemfsoftware/stryker-js-instrumenter": major
---

AtomicUpdateSplit, SynchronizationRemoval and FinalizerEscape are now default mutators, so a run with no mutator option plants Effect concurrency faults; mutation scores and the set of mutants change. Mutator.optInMutators is removed and stockRegistry.optIn is empty; opt-in is a plugin catalog tier. The replacements use Effect 4 APIs and @systemfsoftware/stryker-js declares effect ^4.0.0 as a peer dependency, so a repository on Effect 3 must list the three in mutator.excludedMutations.
