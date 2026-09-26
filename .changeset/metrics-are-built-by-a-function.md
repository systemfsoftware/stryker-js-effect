---
"@systemfsoftware/stryker-js-plugin-interface": major
---

Building mutation metrics from mutants is a function now: `Report.Metrics.fromMutants(mutants)` becomes `Report.metricsFromMutants(mutants)`. Its `mutants` argument is typed as mutants carrying a `MutantStatus`, so a plain `{ status: string }` is refused.

The `Metrics` class is unchanged: same counts, same `totalMutants`/`mutationScore`/`mutationScoreBasedOnCoveredCode` getters, same `MetricsResult` shape.
