---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-html-reporter": patch
"@systemfsoftware/stryker-js-plugin-interface": patch
"@systemfsoftware/stryker-js-plugin-runtime": patch
"@systemfsoftware/stryker-js-typescript-checker": patch
"@systemfsoftware/stryker-js-vitest-runner": patch
"@systemfsoftware/stryker-ignorer-interface": patch
"@systemfsoftware/stryker-ignorer-angular": patch
"@systemfsoftware/stryker-ignorer-effect-schema-declarations": patch
"@systemfsoftware/stryker-ignorer-in-source-vitest-block": patch
"@systemfsoftware/stryker-ignorer-kit": patch
"@systemfsoftware/stryker-js-instrumenter": patch
"@systemfsoftware/oxlint-ignorer-config": patch
---

Effect moves to `4.0.0-rc.117`, together with the `@effect/*` packages these libraries use. Projects that install `effect` next to them need the same release.

- The TypeScript checker and test-runner workers now bundle their own runtime, so the only modules they load from your project are the TypeScript compiler and your test framework.
- The test-runner plugin supports the framework's fifth major release.
- The ignorer interface re-exports the `oxc-parser` 0.150 AST, in which `FormalParameterRest.decorators` is `Array<Decorator>`.
