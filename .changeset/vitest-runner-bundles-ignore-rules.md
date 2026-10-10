---
"@systemfsoftware/stryker-js-vitest-runner": patch
---

The runner worker bundles the current `@systemfsoftware/stryker-js-plugin-interface` code, which now names the ignore rule on every Ignored mutant. The worker shares that vocabulary with a `@systemfsoftware/stryker-js` engine that reports ignore rules.
