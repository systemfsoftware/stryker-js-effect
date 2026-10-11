---
"@systemfsoftware/stryker-js-instrumenter": major
---

AtomicUpdateSplit, SynchronizationRemoval and FinalizerEscape are now default mutators, so a run with no mutator option plants Effect concurrency faults; mutation scores and the set of mutants change. Mutator.optInMutators is removed and stockRegistry.optIn is empty; opt-in is a plugin catalog tier. A repository on Effect 3.x lists the three in mutator.excludedMutations.
