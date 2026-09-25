---
'@systemfsoftware/stryker-vm-harness': patch
---

The vm runner now gives the Vitest API to every module a suite loads that imports `vitest`, not only to files inside the project directory. A Vitest `setupFiles` entry, helper module or workspace package outside the project used to receive a runner-less `vitest` and stop the whole run with "Vitest failed to find the runner"; its `beforeEach` and `it` calls now register against the current test file, as they do under Vitest. Dependencies under `node_modules` stay shared across test files, and `@effect/vitest` and `@systemfsoftware/effect-gherkin-spec` behave as before.
