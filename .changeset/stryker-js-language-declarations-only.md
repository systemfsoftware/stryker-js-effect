---
'@systemfsoftware/stryker-js-language': major
---

This package now publishes declarations only — schemas, branded types, port tags, and tagged unions. The computation it used to carry is removed: `calculateMetrics`, `countMutants`, `classifyExit`, `highestExitClass`, `resolveExitCode`, `planMutationRun`, the `MutationRunIo` runner contract, and the `Ignorer` service type. `ExitClass` and `EXIT_CODE` still ship from this package; the functions that computed them are published by `@systemfsoftware/stryker-js-engine`, and the ignorer contract by `@systemfsoftware/stryker-ignorer-interface`.

To migrate, import those functions from `@systemfsoftware/stryker-js-engine` and the ignorer types from `@systemfsoftware/stryker-ignorer-interface`.
