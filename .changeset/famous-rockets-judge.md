---
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js-vitest-runner": major
"@systemfsoftware/stryker-js-typescript-checker": major
"@systemfsoftware/stryker-js-html-reporter": major
"@systemfsoftware/stryker-test-contribution": major
---

The plugin system now runs each configured TestRunner/Checker/Reporter plugin in its own spawned process over an @effect/rpc wire: plugins load from the project's config-declared specifiers (no glob discovery), boundary failures are typed errors, and plugin spans link into the host trace. Breaking: the in-process plugin Layer contract is removed.
