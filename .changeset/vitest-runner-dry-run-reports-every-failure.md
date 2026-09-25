---
"@systemfsoftware/stryker-js-vitest-runner": patch
---

A failed dry run now names every failing test. The runner used to apply the bail setting to the dry run as well, so Vitest stopped at the first failure and the error listed only that test. Mutant runs still stop at the first failing test unless `disableBail` is set.
