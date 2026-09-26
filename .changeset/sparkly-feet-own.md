---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-instrumenter": patch
"@systemfsoftware/stryker-js-plugin-interface": patch
"@systemfsoftware/stryker-js-plugin-runtime": patch
"@systemfsoftware/stryker-js-vitest-runner": patch
"@systemfsoftware/stryker-js-typescript-checker": patch
"@systemfsoftware/stryker-js-html-reporter": patch
"@systemfsoftware/stryker-js-svelte": patch
"@systemfsoftware/stryker-ignorer-angular": patch
---

Stages now run as cells over workflows, multi-item work runs as Effect streams, pools and worker transport use scoped Effect resources, and named operations are traced with Effect.fn. The Angular ignorer now declares @systemfsoftware/stryker-ignorer-kit as a runtime dependency.
