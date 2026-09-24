---
"@systemfsoftware/stryker-vm-harness": minor
"@systemfsoftware/stryker-js": patch
---

`@systemfsoftware/stryker-vm-harness` is the in-process worker-thread harness that powers the built-in `testRunner: 'vm'`: suites run as native ESM in one worker thread per runner instead of a child process. `@systemfsoftware/stryker-js` now depends on it.
