---
"@systemfsoftware/stryker-js-vitest-runner": major
---

The package now declares Node 24.13.1 or later in `engines`, the same floor as `@systemfsoftware/stryker-js`. On Node 22, a mutant run that filters to named tests ended in an error instead of a verdict. To migrate, install Node 24.13.1 or later.
