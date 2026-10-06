## 8.1.0

### Minor Changes

- The Vitest runner persists transformed modules to a file-system cache under the sandbox and reuses them across the worker threads the standby pool hands out, so a mutant run that lands on a freshly handed-out thread reads the transforms it already paid for instead of recompiling every module. The cache can be turned off with `testRunner: { options: { fsModuleCache: false } }`. Verdicts are unchanged.

### Patch Changes

- The runner no longer lets the ambient `VITEST_MAX_WORKERS` setting raise the number of Vitest workers it runs with, which could start a mutant's covering tests concurrently; with that setting in the environment, a previously recorded killer still runs first and a killed mutant stops at its killer.
