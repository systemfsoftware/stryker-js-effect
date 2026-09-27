---
"@systemfsoftware/stryker-js": major
---

The machine-stream events, the stock mutator catalog and the span taxonomy moved to `@systemfsoftware/stryker-js-cli-contract`; `RunEvent` exposes only what the engine owns, so importing an event from `@systemfsoftware/stryker-js` no longer compiles. A mutator plugin in `plugins` loads its catalog through `strykerMutators` under its own namespace, and a duplicated namespace, a stock mutator name, or a name the provider does not own is refused before instrumentation. `excludedMutations` and `optInMutations` decode against the loaded catalogs, so config refuses a name no catalog declares. Under per-test coverage a mutant no test reaches is reported `NoCoverage` without being run; an interrupted run's checkpoint lists its unsettled mutants as `Pending`, and a completed report holds none.

Import the stream events, the catalog and the taxonomy from the CLI contract.
