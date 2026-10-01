---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-html-reporter": major
"@systemfsoftware/stryker-js-instrumenter": major
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js-plugin-runtime": major
"@systemfsoftware/stryker-js-cli-contract": minor
"@systemfsoftware/stryker-js-typescript-checker": patch
"@systemfsoftware/stryker-js-vitest-runner": patch
---

Effect moves to the stable `4.0.0` release, together with the `@effect/*` packages these libraries use. The `4.0.0` release candidates are no longer supported: install `effect` `^4.0.0` next to these packages before upgrading.

The TypeScript checker and test-runner plugins bundle their own Effect runtime, so they need no change in your project.
