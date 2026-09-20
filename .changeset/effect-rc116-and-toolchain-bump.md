---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-html-reporter": patch
"@systemfsoftware/stryker-js-plugin-interface": patch
"@systemfsoftware/stryker-js-plugin-runtime": patch
"@systemfsoftware/stryker-js-typescript-checker": patch
"@systemfsoftware/stryker-js-vitest-runner": patch
"@systemfsoftware/stryker-test-contribution": patch
"@systemfsoftware/stryker-ignorer-interface": patch
"@systemfsoftware/stryker-ignorer-angular": none
"@systemfsoftware/stryker-ignorer-effect-schema-declarations": none
"@systemfsoftware/stryker-ignorer-in-source-vitest-block": none
"@systemfsoftware/stryker-ignorer-kit": none
"@systemfsoftware/stryker-js-instrumenter": none
"@systemfsoftware/oxlint-ignorer-config": none
---

Effect moves to `4.0.0-rc.116` (with `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest` and `@effect/opentelemetry` on the same release), the `@systemfsoftware/*` toolchain pins move to their current releases, and `vitest` 5 with `oxc-parser` 0.150 come along. Both worker bundles (`stryker-js-typescript-checker`, `stryker-js-vitest-runner`) now inline their whole runtime rather than resolving `effect`, `@effect/*` and the sibling packages from the host's tree, so a worker runs on its own copy of the effect that built it; the project's `typescript` and `vitest` remain the only imports beside Node builtins. The filter-level `arbitrary.candidate` generators that the thresholds schemas carried are gone: v4 no longer reads them, so thresholds still reject a `low` above `high` and the property tests generate the pair from the schema again. Log calls inside `Effect.catch*` handlers moved to `Effect.tapError`/`Effect.tapCause` at the same level and message. `@systemfsoftware/stryker-ignorer-interface` re-exports the 0.150 AST, where `FormalParameterRest.decorators` is now `Array<Decorator>`.
