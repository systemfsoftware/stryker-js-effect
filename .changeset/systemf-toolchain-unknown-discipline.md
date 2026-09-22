---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-html-reporter": patch
"@systemfsoftware/stryker-js-instrumenter": patch
"@systemfsoftware/stryker-js-plugin-interface": patch
"@systemfsoftware/stryker-js-typescript-checker": patch
"@systemfsoftware/stryker-js-vitest-runner": patch
"@systemfsoftware/stryker-test-contribution": none
---

Exported declarations that previously took `unknown` now take a defaulted type parameter: calls that omit the type argument are unchanged, and calls that were previously rejected for passing an unconstrained value are accepted. No runtime behaviour changes.
