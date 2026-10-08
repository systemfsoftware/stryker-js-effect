# @systemfsoftware/stryker-ignorer-angular

## 0.1.3

Effect moves to `4.0.0-rc.117`, together with the `@effect/*` packages these libraries use. Projects that install `effect` next to them need the same release.

- The TypeScript checker and test-runner workers now bundle their own runtime, so the only modules they load from your project are the TypeScript compiler and your test framework.
- The test-runner plugin supports the framework's fifth major release.
- The ignorer interface re-exports the `oxc-parser` 0.150 AST, in which `FormalParameterRest.decorators` is `Array<Decorator>`.

## 0.1.2

### Patch Changes

- Stages now run as cells over workflows, multi-item work runs as Effect streams, pools and worker transport use scoped Effect resources, and named operations are traced with Effect.fn. The Angular ignorer now declares @systemfsoftware/stryker-ignorer-kit as a runtime dependency.

## 0.1.1

### Patch Changes

- Effect moves to `4.0.0-rc.116` (with `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest` and `@effect/opentelemetry` on the same release), the `@systemfsoftware/*` toolchain pins move to their current releases, and `vitest` 5 with `oxc-parser` 0.150 come along. Both worker bundles (`stryker-js-typescript-checker`, `stryker-js-vitest-runner`) now inline their whole runtime rather than resolving `effect`, `@effect/*` and the sibling packages from the host's tree, so a worker runs on its own copy of the effect that built it; the project's `typescript` and `vitest` remain the only imports beside Node builtins. The filter-level `arbitrary.candidate` generators that the thresholds schemas carried are gone: v4 no longer reads them, so thresholds still reject a `low` above `high` and the property tests generate the pair from the schema again. Log calls inside `Effect.catch*` handlers moved to `Effect.tapError`/`Effect.tapCause` at the same level and message. `@systemfsoftware/stryker-ignorer-interface` re-exports the 0.150 AST, where `FormalParameterRest.decorators` is now `Array<Decorator>`.

## 0.1.0

### Minor Changes

- Debut: the Angular signal ignorer as its own package. `strykerIgnorers[0].shouldIgnore(node, ancestors)` suppresses mutations in Angular signal declarations — `input`, `model`, `output`, `viewChild`, `viewChildren`, `contentChild`, `contentChildren` and `query` — recognizing both the signal-function call form and the property-decorator form. The messages explaining each suppression are exported alongside it.

### Patch Changes

- Maintenance release. Every published entry point, export, option, and behaviour is exactly as it was.
