# @systemfsoftware/stryker-ignorer-interface

## 0.1.1

### Patch Changes

- Effect moves to `4.0.0-rc.116` (with `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest` and `@effect/opentelemetry` on the same release), the `@systemfsoftware/*` toolchain pins move to their current releases, and `vitest` 5 with `oxc-parser` 0.150 come along. Both worker bundles (`stryker-js-typescript-checker`, `stryker-js-vitest-runner`) now inline their whole runtime rather than resolving `effect`, `@effect/*` and the sibling packages from the host's tree, so a worker runs on its own copy of the effect that built it; the project's `typescript` and `vitest` remain the only imports beside Node builtins. The filter-level `arbitrary.candidate` generators that the thresholds schemas carried are gone: v4 no longer reads them, so thresholds still reject a `low` above `high` and the property tests generate the pair from the schema again. Log calls inside `Effect.catch*` handlers moved to `Effect.tapError`/`Effect.tapCause` at the same level and message. `@systemfsoftware/stryker-ignorer-interface` re-exports the 0.150 AST, where `FormalParameterRest.decorators` is now `Array<Decorator>`.

## 0.1.0

### Minor Changes

- First release. This is the contract an ignorer is written against: one `Ignorer`
  descriptor (`{ name, shouldIgnore }`) whose decision receives the node and its
  ancestors — nearest first, fully typed positions, nothing unknown. The whole AST
  vocabulary of the producing parser is re-exported with optional spans, so
  hand-built fixtures only need the fields a rule actually reads.

  Hosts that traverse a tree get `Walker` and `WalkVisitors` types from the same
  contract: a walker drives `enter`/`leave` with the node and its ancestor stack,
  and the host supplies the traversal itself. The package ships no runtime value
  and no runtime dependencies, so adopting it costs nothing beyond the types.

### Patch Changes

- Maintenance release. Every published entry point, export, option, and behaviour is exactly as it was.
