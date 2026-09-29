---
"@systemfsoftware/stryker-js": major
---

The machine-stream events, the stock mutator catalog and the span taxonomy moved to `@systemfsoftware/stryker-js-cli-contract`; import them from there: `RunEvent` no longer re-exports an event the engine does not own. A mutator plugin loads its catalog through `strykerMutators` under its own namespace, and a duplicated namespace, a stock mutator name, or a name the provider does not own is refused before instrumentation; `excludedMutations` and `optInMutations` refuse a name no loaded catalog declares. Under per-test coverage an unreached mutant is `NoCoverage` without a run, and an interrupted run's checkpoint lists its unsettled mutants as `Pending` where a completed report holds none. A `verdict` event's mutants carry string ids. With `OTEL_ENABLED=true` spans export in batches; one request per span lost spans at random because the OTLP exporter drops exports beyond 30 in flight.
