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

## License

Apache-2.0. Part of [systemfsoftware](https://github.com/systemfsoftware/stryker-js-effect/tree/main/packages/stryker-js-instrumenter#readme).
