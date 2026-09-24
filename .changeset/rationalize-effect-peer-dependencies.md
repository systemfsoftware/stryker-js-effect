---
"@systemfsoftware/stryker-js": minor
"@systemfsoftware/stryker-js-vitest-runner": minor
"@systemfsoftware/stryker-test-contribution": minor
---

Projects using `@systemfsoftware/stryker-js` as a CLI tool no longer receive warnings or automatic installs for `effect`. The peer dependency is now optional, required only when importing programmatic APIs from the package.

`@systemfsoftware/stryker-js-vitest-runner` and `@systemfsoftware/stryker-test-contribution` no longer declare a peer dependency on `effect`.
