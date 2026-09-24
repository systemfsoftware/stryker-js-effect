## 5.0.4

### Patch Changes

- Three opt-in mutators plant Effect concurrency faults on top of the default set, so a mutation run can check that your concurrency tests catch races. `AtomicUpdateSplit` splits read-modify-write calls on `Ref` and `SynchronizedRef` into a separate read, a yield, and a separate write. `SynchronizationRemoval` removes semaphore permits, `Effect.uninterruptible`, and `Effect.uninterruptibleMask`. `FinalizerEscape` stops `ensuring`, `onExit`, `onError`, `onInterrupt`, `acquireRelease`, and `acquireUseRelease` cleanup from running on interruption. All three are off by default. Enable any subset by listing them under `mutator: { optInMutations: [...] }` in your configuration. A name that is not an opt-in mutator fails the run, and the error lists the known names. The replacements use Effect 4 APIs, so a repository on Effect 3.x must not opt in.
