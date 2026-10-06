---
"@systemfsoftware/stryker-js-vitest-runner": patch
---

The runner no longer lets the ambient `VITEST_MAX_WORKERS` setting raise the number of Vitest workers it runs with, which could start a mutant's covering tests concurrently; with that setting in the environment, a previously recorded killer still runs first and a killed mutant stops at its killer.
