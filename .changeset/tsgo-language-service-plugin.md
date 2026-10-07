---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-instrumenter": patch
"@systemfsoftware/stryker-js-plugin-interface": patch
"@systemfsoftware/stryker-js-plugin-runtime": patch
"@systemfsoftware/stryker-js-typescript-checker": patch
"@systemfsoftware/stryker-js-html-reporter": patch
"@systemfsoftware/stryker-js-cli-contract": patch
"@systemfsoftware/stryker-framework-interface": patch
"@systemfsoftware/stryker-js-angular": patch
"@systemfsoftware/stryker-js-svelte": patch
"@systemfsoftware/stryker-ignorer-interface": patch
"@systemfsoftware/stryker-ignorer-effect-schema-declarations": patch
"@systemfsoftware/stryker-ignorer-in-source-vitest-block": patch
"@systemfsoftware/oxlint-ignorer-config": patch
---

Enable the `@effect/language-service` tsgo plugin in every source package's `tsconfig.app.json` and `tsconfig.test.json`, and bump `@effect/tsgo` to `^0.50.0`. This turns on Effect-aware diagnostics during `effect-tsgo` type checking; it changes no runtime behaviour or public API.
