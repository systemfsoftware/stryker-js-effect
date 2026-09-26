---
"@systemfsoftware/stryker-js": major
---

The machine stream's tested-mutant event is one declaration now. `RunEvent.RunMutantTested` is a codec whose type is `Reporter.MutantTested` and whose encoded form is the stream's `{"_tag":"mutant"}` line, so the stream carries the domain event and the boundary renames its tag and fields. The emitted stdout bytes and their order are unchanged.

Two published names moved with it: `RunEvent.RunMutantTested` no longer constructs (`RunMutantTested.make` is gone; build a `Reporter.MutantTested` instead), and `RunEvent.MetricsResultFromReport.fromFiles` is replaced by the function `RunEvent.metricsResultFromFiles`.
