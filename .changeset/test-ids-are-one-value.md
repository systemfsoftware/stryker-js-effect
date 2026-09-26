---
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-vitest-runner": major
"@systemfsoftware/stryker-test-contribution": major
---

Test identifiers are one value: `TestRunner.TestId`, a non-empty branded string carrying the runner's `file#test name` form. Test runner results, report test definitions, a mutant's killers and coverers, per-test hit records, and the test-contribution evaluation all speak that one type instead of bare strings.

Mint one with `TestRunner.TestId.make(...)` where a runner derives a test id; the machine stream and mutation report schemas brand the ids they decode.
