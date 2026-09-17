---
'@systemfsoftware/stryker-js-instrumenter': major
---

`disableTypeChecks` and `instrument` now return lazy `Effect` values instead of a `Promise` and a plain result, so a caller decides when the transformation runs: `disableTypeChecks(file)` is `Effect<File, InstrumentError>` and `instrument(files, options)` is `Effect<InstrumentResult, InstrumentError>`. Interpret them with your own runtime — `Effect.runPromise(disableTypeChecks(file))` reproduces the old await.

The Angular signal ignorer moved out of this package to `@systemfsoftware/stryker-ignorer-angular`, and the `strykerPlugins` and `frameworkPluginsFileUrl` exports are gone. A plugin package discovers its ignorers through the ignorer contract instead.
