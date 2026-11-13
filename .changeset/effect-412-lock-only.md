---
"@systemfsoftware/stryker-js-cli-contract": none
"@systemfsoftware/stryker-js-html-reporter": none
"@systemfsoftware/stryker-js-instrumenter": none
"@systemfsoftware/stryker-js-plugin-runtime": none
"@systemfsoftware/stryker-js-typescript-checker": none
"@systemfsoftware/stryker-js-plugin-interface": none
"@systemfsoftware/stryker-framework-interface": none
"@systemfsoftware/stryker-ignorer-angular": none
"@systemfsoftware/stryker-ignorer-effect-schema-declarations": none
"@systemfsoftware/stryker-ignorer-in-source-vitest-block": none
"@systemfsoftware/stryker-ignorer-interface": none
"@systemfsoftware/stryker-ignorer-kit": none
"@systemfsoftware/stryker-js-angular": none
"@systemfsoftware/stryker-js-svelte": none
---

The workspace pins effect and the @effect packages at 4.1.2 instead of 4.1.0. 4.1.3 and 4.1.4 deadlock the checker RPC conformance scenarios. Every manifest keeps its ^4.1.0 range, so what a consumer installs is unchanged.
