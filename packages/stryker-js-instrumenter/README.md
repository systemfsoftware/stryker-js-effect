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

File formats resolve through a format registry: `coreFormatRegistry` carries the built-in `js`/`ts`/`tsx` entries, `frameworkEntryOf` adapts a framework's `Framework` object into an entry, and `registerEntries` folds additions into a registry (an extension already claimed stays with the earlier entry). `instrument(files, options, registry)` and `disableTypeChecks(file, registry)` accept that registry — defaulting to the core one — and `instrument` returns the files it skipped because no entry claimed their extension.

`options.mutantSetPolicy` states which mutant set the run wants and is required: `'default'` is the product default, and `'full'` turns off the mutant-set pruning the instrumenter would otherwise apply, so the run keeps every mutation the selected mutators can plant.

## Effect concurrency mutators

Three default mutators plant Effect concurrency faults:

- **AtomicUpdateSplit** turns read-modify-write calls such as `Ref.update` or `SynchronizedRef.modify` into a separate read, a yield, and a separate write, so an interleaved mutation can lose an update.
- **SynchronizationRemoval** drops the guarding effect of `Semaphore.withPermits`/`withPermit` and `Effect.uninterruptible`, letting code that assumed exclusivity or uninterruptibility run without it.
- **FinalizerEscape** weakens `Effect.ensuring`, `Effect.onExit`, `Effect.onError`, and `Effect.onInterrupt` so their cleanup no longer runs on interruption.

The replacements these mutators plant use Effect 4 APIs. `@systemfsoftware/stryker-js` declares `effect` `^4.0.0` as a peer dependency, so Effect 3 is outside the supported range; a repository on Effect 3 must list the three in `mutator.excludedMutations`:

```json
{
  "mutator": {
    "excludedMutations": ["AtomicUpdateSplit", "SynchronizationRemoval", "FinalizerEscape"]
  }
}
```

Every stock mutator is default-tier. `mutator.optInMutations` names opt-in entries from a plugin's mutator catalog; naming a stock mutator there, or a mutator no loaded catalog declares, fails the run before instrumentation as a config failure naming the entry.

## License

Apache-2.0. Part of [systemfsoftware](https://github.com/systemfsoftware/stryker-js-effect/tree/main/packages/stryker-js-instrumenter#readme).
