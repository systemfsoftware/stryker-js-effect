---
"@systemfsoftware/stryker-framework-interface": patch
"@systemfsoftware/stryker-ignorer-angular": patch
"@systemfsoftware/stryker-ignorer-effect-schema-declarations": patch
"@systemfsoftware/stryker-ignorer-in-source-vitest-block": patch
"@systemfsoftware/stryker-ignorer-interface": patch
"@systemfsoftware/stryker-ignorer-kit": patch
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-angular": patch
"@systemfsoftware/stryker-js-cli-contract": patch
"@systemfsoftware/stryker-js-html-reporter": none
"@systemfsoftware/stryker-js-instrumenter": none
"@systemfsoftware/stryker-js-plugin-interface": patch
"@systemfsoftware/stryker-js-plugin-runtime": patch
"@systemfsoftware/stryker-js-svelte": patch
"@systemfsoftware/stryker-js-typescript-checker": patch
"@systemfsoftware/stryker-js-vitest-runner": patch
---

The workspace dogfoods @systemfsoftware/stryker-js 23.0.0 and the TypeScript checker 10.0.0, and every package resolves one @systemfsoftware/effect-cell-types (12.1.4). The TypeScript checker and the vitest runner bundle 12.1.4 in place of 12.0.0, and stryker-js and the checker bundle @jsr/std__jsonc 1.0.3 in place of 1.0.2. Every package that takes @systemfsoftware/effect-cell-types from the catalog publishes the range ^12.1.4 in place of ^12.0.0.
