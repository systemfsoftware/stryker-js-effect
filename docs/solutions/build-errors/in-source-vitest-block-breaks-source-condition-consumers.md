---
title: An in-source vitest block breaks the typecheck of every package that reads its source
date: 2026-09-24
category: build-errors
module: stryker-js-family
problem_type: build_error
component: tooling
severity: medium
symptoms:
  - "`tsc` fails in packages nobody edited with `TS2339: Property 'vitest' does not exist on type 'ImportMeta'`"
  - "The package that owns the `if (import.meta.vitest)` block typechecks and tests green, because its own tsconfig lists `vitest/importMeta` in `types`"
root_cause: config_error
resolution_type: code_fix
tags: [vitest, in-source-tests, import-meta, source-condition, customConditions, typecheck]
---

# An in-source vitest block breaks the typecheck of every package that reads its source

## Problem

During issue #83, the opt-in mutator registry tests were written as an
`if (import.meta.vitest) { ... }` block inside the instrumenter's `Mutator`
module, and `vitest/importMeta` was added to the instrumenter tsconfig `types`.
The instrumenter was green. `tsc` then failed with `TS2339` on `ImportMeta` in
`@systemfsoftware/stryker-js`, `@systemfsoftware/stryker-js-typescript-checker`,
and other untouched packages.

## Failure mechanism

1. Workspace tsconfigs set `customConditions: ["@systemfsoftware/source"]`, so
   a bare import of `@systemfsoftware/stryker-js-instrumenter` resolves to its
   `.ts` source, not to its emitted declarations.
2. A source file joins the importing program and is checked under the
   **importer's** `compilerOptions.types`, not the owner's.
3. `import.meta.vitest` is declared only by `vitest/importMeta`. Consumers list
   `["node"]` or `["node", "vitest/globals"]`, so the property is missing.

Result: `types` required by source file F = union over every program that
includes F. A `types` entry in F's own package covers one of those programs.

## Architectural invariants

- **Source-shared files are typed by their weakest consumer.** A file reachable
  through the source condition may use only globals and ambient declarations
  that every consuming tsconfig provides.
- **Tests live outside the shared source graph.** In a package consumed through
  the source condition, test code belongs in the package's tests directory, which no other
  package imports.

```text
WRONG  src/Mutator.ts:   if (import.meta.vitest) { ...registry cases... }
       tsconfig types:   ["node", "vitest/importMeta"]   # owner only
RIGHT  src/Mutator.ts:   production code only
       tests/mutator-selection.integration.test.ts:  the same cases
       tsconfig types:   ["node"]
```

Adding `vitest/importMeta` to every consumer's `types` would also compile, but
then each consumer's type surface depends on one package's test style.

## Prevention

- Code smell: `import.meta.vitest` in a `src` file of a package that another
  workspace tsconfig imports under `@systemfsoftware/source`.
- Verification: after touching a shared package's `src`, run `pnpm typecheck`
  at the repo root, not only the owning package's typecheck. The owner's
  check cannot see this failure.
