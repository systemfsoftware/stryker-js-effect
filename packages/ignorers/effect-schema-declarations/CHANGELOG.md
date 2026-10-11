# @systemfsoftware/stryker-ignorer-effect-schema-declarations

## 0.3.0

A schema that annotates a `recursionBudget` beside a behaviour key such as `toEquivalence` no longer fails the dry run with `Budget_RequiresTransform`.

- The object holding a `recursionBudget` in the first argument of `annotate` or `annotations` is now ignored whatever its other keys are. The other keys' values are still mutated.
- The `recursion-budget` reason calls `recursionBudget` metadata that only the recursion-budget transform, its runtime and the schema recursion laws read. The `recursion-budget-holder` reason and `RECURSION_BUDGET_HOLDER_IGNORED` drop "beside documentation only".
- New `KEEP_ADVICE` maps every reason code to the next action that keeps its mutants tested: `KEEP_RECURSION_BUDGET_MUTANT` (remove the `recursionBudget` annotation) for the two budget codes, `KEEP_IGNORED_MUTANT` for the rest. A `recursionBudget` annotation on a recursive schema is no longer mutated, so a run over a project using `@systemfsoftware/effect-schema-recursion-budget` no longer fails its dry run with `Budget_RequiresTransform`. Both the annotate object holding the budget and the budget value are reported as `Ignored`.

Every reason the ignorer reports now starts with a stable code, as `effect-schema-declarations/<code>: <why>`. `REASON_CODES` maps each code to what it means, and `KEEP_IGNORED_MUTANT` says how to keep a mutant the ignorer removes.

Breaking: the exported reason constants (`BRAND_NAME_IGNORED`, `TYPE_ID_IGNORED`, and the rest) now hold the coded text. Code that compares against the old text must use the constants or match on the code.

## 0.2.1

Effect moves to `4.0.0-rc.117`, together with the `@effect/*` packages these libraries use. Projects that install `effect` next to them need the same release.

- The TypeScript checker and test-runner workers now bundle their own runtime, so the only modules they load from your project are the TypeScript compiler and your test framework.
- The test-runner plugin supports the framework's fifth major release.
- The ignorer interface re-exports the `oxc-parser` 0.150 AST, in which `FormalParameterRest.decorators` is `Array<Decorator>`. Enable the `@effect/language-service` tsgo plugin in every source package's `tsconfig.app.json` and `tsconfig.test.json`, and bump `@effect/tsgo` to `^0.50.0`. This turns on Effect-aware diagnostics during `effect-tsgo` type checking; it changes no runtime behaviour or public API.

## 0.2.0

### Minor Changes

- The ignorer recognizes the declaration forms Effect Schema files use today, so far fewer unkillable mutants reach your report. A `TaggedStruct` tag, an `annotate({ identifier, description, title })` object, a filter or check annotation object such as `makeFilter(predicate, { expected })`, a declaration's `toCodecArbitrary` callback and the arbitrary link transformation it returns, a decoding or constructor default, and a `TypeId` identity constant are all reported as `Ignored` now. Predicates, bounds, patterns, literal vocabularies, struct field sets, and codec decode/encode transformations keep being mutated. Each newly recognized form carries its own exported reason constant.

## 0.1.1

### Patch Changes

- Effect moves to `4.0.0-rc.116` (with `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest` and `@effect/opentelemetry` on the same release), the `@systemfsoftware/*` toolchain pins move to their current releases, and `vitest` 5 with `oxc-parser` 0.150 come along. Both worker bundles (`stryker-js-typescript-checker`, `stryker-js-vitest-runner`) now inline their whole runtime rather than resolving `effect`, `@effect/*` and the sibling packages from the host's tree, so a worker runs on its own copy of the effect that built it; the project's `typescript` and `vitest` remain the only imports beside Node builtins. The filter-level `arbitrary.candidate` generators that the thresholds schemas carried are gone: v4 no longer reads them, so thresholds still reject a `low` above `high` and the property tests generate the pair from the schema again. Log calls inside `Effect.catch*` handlers moved to `Effect.tapError`/`Effect.tapCause` at the same level and message. `@systemfsoftware/stryker-ignorer-interface` re-exports the 0.150 AST, where `FormalParameterRest.decorators` is now `Array<Decorator>`.

## 0.1.0

### Minor Changes

- Removed the `decideSchemaDeclarationIgnore` and `CLASS_FIELDS_IGNORED` exports. The ignorer still
  registers under the name `effect-schema-declarations` with unchanged recognized declaration shapes
  and unchanged ignore reasons. If you called the decision function directly, consult the descriptor
  instead: `strykerIgnorers[0].shouldIgnore(node, ancestors)`.

- First release. This ignorer keeps mutants inside Effect Schema declarations out of
  a mutation run: a symbol, a tagged error, an annotation or a class body only
  declares a type, so no run can observe the change.

  It has no runtime dependencies, and migrating from the plugin you use today is a
  rename in your plugins list — the ignorer keeps the name it already had.

### Patch Changes

- Maintenance release. Every published entry point, export, option, and behaviour is exactly as it was.
