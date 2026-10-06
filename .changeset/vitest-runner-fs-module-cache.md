---
"@systemfsoftware/stryker-js-vitest-runner": minor
---

The Vitest runner persists transformed modules to a file-system cache under the sandbox and reuses them across the worker threads the standby pool hands out, so a mutant run that lands on a freshly handed-out thread reads the transforms it already paid for instead of recompiling every module. The cache can be turned off with `testRunner: { options: { fsModuleCache: false } }`. Verdicts are unchanged.
