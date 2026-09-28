---
"@systemfsoftware/stryker-js": major
---

The incremental cache now reuses a verdict only when nothing that could change it has changed: the covering tests and every module they import, the run inputs (lockfile and configuration), and the mutant-set policy. Moving code or releasing a new version no longer throws the cache away. Incremental reports written by earlier versions are discarded once.

A mutant whose covering tests did not run is retried once, then reported as `RuntimeError` with reason `no covering test executed`.

The new `mutator.mutantSetPolicy` option defaults to `'default'`. Under it, mutants in logging, telemetry, timing, and configuration-default calls, redundant relational variants, and replacements identical to the original are reported as `Ignored` with a named rule instead of being run. Set `mutator.mutantSetPolicy: 'full'` to keep the previous mutant set.
