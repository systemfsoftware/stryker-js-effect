---

---

A mutation run's outcome is now `MutationTestDone`, replacing `RunOutcome`; the run's stage markers — `PrepareDone`, `InstrumentDone`, `DryRunDone`, `MutationTestDone` — are published individually, and `runMutationTest` returns `Effect<MutationTestDone, StageError, StageServices>`.

This package also adopts the computation the language package gave up: `calculateMetrics` and `countMutants` publish here now, as do `ExitClass`, `EXIT_CODE`, `highestExitClass`, `resolveExitCode` and `verdictExitClass`. `PrepareDone.ignorers` is typed by the `Ignorer` contract from `@systemfsoftware/stryker-ignorer-interface`.
