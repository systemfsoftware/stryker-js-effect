---
title: effect-tsgo diagnostics as a per-package lint task
date: 2026-09-17
input_shape: solution
subject: effect-tsgo wiring and diagnostic fixes
applies_when:
  - wiring Effect language-service diagnostics into a pnpm/turbo monorepo
  - fixing newSchemaClass, globalDate, preferSchemaOverJson, effectSucceedWithVoid, deterministicKeys findings
---

# Effect-tsgo diagnostics as a per-package lint task

Each workspace package runs the Effect language-service diagnostic binary against its
own project as a `lint:tsgo` script, wired into the shared task gate next to `lint`.
Package configs extend the shared Effect severity policy, so every finding lands at
error severity with no per-package tuning. The binary arrives via the root `prepare`
patch hook; toolchain packages resolve it through the pnpm workspace root, so no
per-package binary dependency is needed.

## Architectural invariants

**INV-1: One diagnostic edge per package.** The language-service check runs once per
package project (`diagnostics --project tsconfig.json`), never per file or per
import. Rationale: per-file edges drift out of sync with the shared severity policy;
one edge keeps policy changes atomic.

**INV-2: Decode at the boundary, never cast across it.** Outside data (file text,
JSON strings, unknown module shapes) enters through a Schema codec
(`fromJsonString`, `decodeOption`/`decodeResult`/`decodeEffect` matched to the
input's static type). `as` assertions on outside data are banned: they certify a
shape nothing verified.

```text
WRONG: const program = result.program as unknown as Program
RIGHT: const decoded = S.decodeOption(OxcProgramSchema)(result.program)
       Option.getOrThrow(decoded)   // boundary fails loudly, interior stays typed
```

**INV-3: Errors are values with identity.** Schema-class failures construct via
`.make(...)`, never `new`. Callers branch on the schema guard (`Schema.is`), not
`instanceof`: the guard validates structure, so deserialized lookalikes classify
correctly while prototype checks silently miss them.

**INV-4: Finalization survives the rewrite.** A mechanical translation of
`try { loop } finally { cleanup }` into sequential `yield*` calls inside `Effect.gen`
drops the `finally`: if the loop Effect fails, the trailing cleanup never runs.
Any cleanup the old code guaranteed runs under `Effect.ensuring`.

```text
WRONG: yield* drainEvents(iterator, state)
       yield* Effect.sync(() => finishBar(state))   // skipped on drain failure
RIGHT: yield* drainEvents(iterator, state).pipe(
         Effect.ensuring(Effect.sync(() => finishBar(state))),
       )
```

**INV-5: Lazy values stay lazy.** A zero-arg function returning an Effect that the
diagnostic flags as indirection becomes a const Effect value — and every caller
drops the call parens in the same change. A function-to-value shape change without
the caller migration is a type error, not a cleanup.

## Code smells

- `new X(...)` on a Schema class → `.make(...)`.
- `instanceof` on a TaggedError → `Schema.is`.
- `JSON.parse` / `JSON.stringify` → `fromJsonString` codec pair
  (`encodeEffect(fromJsonString(...))` for the write direction).
- `() => Effect.succeed(undefined)` in a typed slot → shared `undefined` binding
  passed to `Effect.succeed` (satisfies the void-success rule, the assertion ban,
  and the typechecker at once).
- `Match.value(bool).pipe(Match.when(true, ...))` wrapping an inner predicate match
  → collapse to the inner match; the outer tests the same predicate twice.
- `Option.match(value, { onNone: () => undefined, onSome: (v) => v })` →
  `Option.getOrUndefined(value)`.
- `new Date()` → `DateTime.Utc` read through `Clock` (unsafe construction only at
  the boundary); schema encode may reorder keys, so expect diff noise on rewritten
  config documents.
