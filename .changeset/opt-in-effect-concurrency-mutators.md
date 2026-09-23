---
"@systemfsoftware/stryker-js-instrumenter": minor
"@systemfsoftware/stryker-js-plugin-interface": minor
"@systemfsoftware/stryker-js": minor
"@systemfsoftware/stryker-js-plugin-runtime": patch
---

Three opt-in mutators plant Effect concurrency faults on top of the default set, for stress-testing code that must stay correct under interleaving. `AtomicUpdateSplit` turns read-modify-write calls on `Ref`/`SynchronizedRef` into a separate read, a yield, and a separate write. `SynchronizationRemoval` lets guarded sections run without their semaphore permit and without `Effect.uninterruptible`. `FinalizerEscape` stops `Effect.ensuring`, `Effect.onExit`, `Effect.onError`, and `Effect.onInterrupt` cleanup from running on interruption. All three are off by default; enable any subset with `mutator: { optInMutations: [...] }` in the Stryker config. A name that is not an opt-in mutator fails the run and lists the known ones. The planted replacements use Effect 4 APIs, so a repository on Effect 3.x must not opt in.
