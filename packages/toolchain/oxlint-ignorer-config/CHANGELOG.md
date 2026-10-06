# @systemfsoftware/oxlint-ignorer-config

## 0.1.1

### Patch Changes

- Effect moves to `4.0.0-rc.116` (with `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest` and `@effect/opentelemetry` on the same release), the `@systemfsoftware/*` toolchain pins move to their current releases, and `vitest` 5 with `oxc-parser` 0.150 come along. Both worker bundles (`stryker-js-typescript-checker`, `stryker-js-vitest-runner`) now inline their whole runtime rather than resolving `effect`, `@effect/*` and the sibling packages from the host's tree, so a worker runs on its own copy of the effect that built it; the project's `typescript` and `vitest` remain the only imports beside Node builtins. The filter-level `arbitrary.candidate` generators that the thresholds schemas carried are gone: v4 no longer reads them, so thresholds still reject a `low` above `high` and the property tests generate the pair from the schema again. Log calls inside `Effect.catch*` handlers moved to `Effect.tapError`/`Effect.tapCause` at the same level and message. `@systemfsoftware/stryker-ignorer-interface` re-exports the 0.150 AST, where `FormalParameterRest.decorators` is now `Array<Decorator>`.

## 0.1.0

### Minor Changes

- The preset now denies the `process` global. Ignorer packages already carry no process uses, so no migration is needed.

- First release. This is the preset an ignorer package is graded by: it holds a
  decision to one path, refuses type assertions and `any` on data read from
  outside, and rejects any import that would put the StrykerJS runtime behind an
  ignorer — Effect and the family presets included.

  It extends nothing, so adopting it is a single `extends: [preset]` entry in
  your lint configuration.

### Patch Changes

- Maintenance release. Every published entry point, export, option, and behaviour is exactly as it was.
