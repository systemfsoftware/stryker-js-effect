---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-plugin-interface": minor
"@systemfsoftware/stryker-js-cli-contract": minor
---

Mutation testing is now incremental by default: `incremental` defaults to `true`, so an unchanged mutant whose covering tests are unchanged is re-used instead of re-run. `--full` (aliasing the old `--force`) re-verifies every mutant, ignoring the cache and the persisted dry run. The `verdict` stream event records `incrementalMode` (`incremental` or `full`). A run with no reusable cache falls back to a full run as before.
