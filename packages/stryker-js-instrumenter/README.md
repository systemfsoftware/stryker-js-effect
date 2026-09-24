# @systemfsoftware/stryker-js-instrumenter

Parses source files, applies their configured mutators, and produces the mutant set for a mutation run.

## Install

```sh
pnpm add @systemfsoftware/stryker-js-instrumenter
```

## Entry points

- `@systemfsoftware/stryker-js-instrumenter`

## Use

The instrumenter is used internally by the Stryker mutation testing framework to instrument source files with mutant coverage and switching logic.

## Opt-in mutators

Three mutators that plant Effect concurrency faults are available on request and stay out of the default set. Enable any subset in your Stryker config:

```json
{
  "mutator": {
    "optInMutations": ["AtomicUpdateSplit", "SynchronizationRemoval", "FinalizerEscape"]
  }
}
```

- **AtomicUpdateSplit** turns read-modify-write calls such as `Ref.update` or `SynchronizedRef.modify` into a separate read, a yield, and a separate write, so an interleaved mutation can lose an update.
- **SynchronizationRemoval** drops the guarding effect of `Semaphore.withPermits`/`withPermit` and `Effect.uninterruptible`, letting code that assumed exclusivity or uninterruptibility run without it.
- **FinalizerEscape** weakens `Effect.ensuring`, `Effect.onExit`, `Effect.onError`, and `Effect.onInterrupt` so their cleanup no longer runs on interruption.

Naming a mutator that does not exist fails the run and lists the names that do. The replacements these mutators plant use Effect 4 APIs, so a repository on Effect 3.x must not opt in.

## License

Apache-2.0. Part of [systemfsoftware](https://github.com/systemfsoftware/stryker-js-effect/tree/main/packages/stryker-js-instrumenter#readme).
