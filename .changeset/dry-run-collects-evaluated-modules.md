---
"@systemfsoftware/stryker-js-vitest-runner": patch
---

The dry run now reports the modules each test file evaluated, reading Vitest's per-worker module execution record at the end of every test file and returning it on the dry run's result as `testFileModules`. The evidence is gathered only on the dry run, so mutant runs pay nothing extra, and it is keyed by the absolute test file path.
