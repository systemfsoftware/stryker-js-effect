---
"@systemfsoftware/stryker-js": major
---

Runs now plant AtomicUpdateSplit, SynchronizationRemoval and FinalizerEscape by default, so scores and the mutant set change. Naming one of them in mutator.optInMutations refuses the run as a config failure (default-tier mutator); remove it from that list, or move it to mutator.excludedMutations to keep it off. Their replacements use Effect 4 APIs and the peer range is effect ^4.0.0, so a repository on Effect 3 must list the three in mutator.excludedMutations.
