---
"@systemfsoftware/stryker-js": patch
---

The `stryker.cli.run` trace span now records the failure text in its `stryker.run.error` attribute for every failed run. It was empty unless the run was interrupted, so a failed dry run, a failing checker, or a rejected argument left no reason in the exported trace.
