---
"@systemfsoftware/stryker-js-vitest-runner": minor
---

The dry run now reports, as `testFileModules`, the modules each test file evaluated, including modules it imported at runtime through a computed `import()`. Mutant runs are unaffected. On Vitest setups where this information is not available, the field is left out.
