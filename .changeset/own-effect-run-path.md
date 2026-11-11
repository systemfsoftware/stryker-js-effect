---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-typescript-checker": major
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js-plugin-runtime": major
"@systemfsoftware/stryker-js-instrumenter": major
"@systemfsoftware/stryker-js-cli-contract": minor
"@systemfsoftware/stryker-js-vitest-runner": patch
"@systemfsoftware/stryker-js-engine": minor
---

A mutation run no longer depends on the `effect` version of the project it runs in.

- `@systemfsoftware/stryker-js`, the typescript checker and the vitest runner bundle the `effect` copy they run on and declare it nowhere: not as a dependency, not as a peer. `./config`, `./promises` and `./events` of stryker-js, and `./runtime` and `./type-query` of the checker, run on that bundled copy and ship declarations that import no `effect` type. The checker's `./runtime` and `./type-query` therefore reach your own Effect code only through string-keyed services, not through shared class identities.
- `@systemfsoftware/stryker-js` no longer exports the Effect-native host API at `.`. It is the new `@systemfsoftware/stryker-js-engine` package, which declares `effect` as a required peer. Import `Engine`, `Worker`, `Plugin`, `Configuration`, `Checker`, `RunEvent`, `Serve`, `Mcp`, `SourceParser`, `GitDiff` and `ImportClosure` from it.
- `@systemfsoftware/stryker-js-plugin-interface`, `-plugin-runtime`, `-instrumenter` and `-cli-contract` take `effect` as a required peer instead of a dependency, so each project shares one `effect` instance with them.
- `@systemfsoftware/stryker-js-plugin-interface` drops the `Evaluator` service and `EvaluatorFailed`; nothing in the engine called an evaluator. The `Evaluator` plugin kind stays as data.
- `@systemfsoftware/stryker-js-vitest-runner` stops listing dependencies its worker bundle never imported.
