---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-vitest-runner": patch
---

A run whose selected files produce no mutants, for example because no loaded framework claims them, now runs every test in the dry run and finishes with an empty report. With `testRunner: 'vm'` or `'vitest'` it used to fail with "No tests were executed", because the dry run only looked for tests related to those files. The dry run now relates tests only to the files that carry mutants.
