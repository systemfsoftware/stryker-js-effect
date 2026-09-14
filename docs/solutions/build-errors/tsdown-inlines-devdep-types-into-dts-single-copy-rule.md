---
title: tsdown inlines devDependency types into emitted d.ts; types-only workspace packages belong in dependencies
date: 2026-09-14
category: build-errors
module: stryker-js-family
problem_type: build_error
component: tooling
severity: high
framework_version: tsdown 0.23.0 / typescript 5.9.3 (api-extractor bundler)
symptoms:
  - "`TS2321: Excessive stack depth comparing types 'Node' and 'Node_2'` at a seam where two packages meet, followed by `TS7053`/`TS2339`/`TS7006` degradations in files that never import the changed package"
  - "The same source typechecks green in one package and explodes in the consumer, with no code change in the failing file"
  - "`grep -c \"from '<pkg>'\" dist/index.d.ts` prints 0 for a package whose types the file clearly uses"
root_cause: config_error
resolution_type: dependency_update
tags: [tsdown, dts, api-extractor, exactOptionalPropertyTypes, devdependencies, type-externalization, workspace]
---

# tsdown inlines devDependency types into emitted d.ts; types-only workspace packages belong in dependencies

## Problem

The ignorer-walker-contract branch moved the family onto one AST vocabulary
(`Node` and ~140 aliases derived from `@oxc-project/types`, a 372-member
recursive union with cyclic `parent?` references). After the language package
rebuilt its declarations, the engine package failed `tsc` with `TS2321
Excessive stack depth comparing types 'Node' and 'Node_2'` at the ignorer
consultation seam, and the cascade degraded unrelated `Mutator.ts` and
`print/index.ts` code into implicit-`any` and missing-property errors.

## Architectural invariant

A published declaration file must hold **one physical copy** of any recursive
union that crosses package seams. tsdown's declaration emitter decides where
that copy lives by dependency class, not by import graph:

- types from declared runtime `dependencies` stay external — the emitted d.ts
  keeps `import type { ... } from '<pkg>'`;
- everything else, including `devDependencies`, is **inlined** into a private
  rolled-up copy (tsdown 0.23 hint: "Detected dependencies in bundle").

Two structurally identical copies of a recursive conditional/mapped type are
different type instantiations to tsc. When they meet at one assignment, the
checker compares them member-by-member across the recursion and exceeds its
stack; error recovery then poisons the union for unrelated files. The failure
appears far from the seam, which makes it expensive to diagnose blind.

## Root cause

`@systemfsoftware/stryker-ignorer-interface` sat in language's
`devDependencies`, so every rebuild of language's `dist/index.d.mts` inlined a
fresh private copy of the interface's `Node`. The engine imported the interface
directly — a second copy — and the seam compared them.

## Solution

- Declare the types-only package in `dependencies` (not `devDependencies`) of
  every package whose public surface references its types; verify
  externalization with `grep -c "from '@systemfsoftware/stryker-ignorer-interface'"
  dist/index.d.mts` — `1` (or more, one per entry) means external, `0` means
  inlined.
- Where two packages each derived their own copy of the same vocabulary, unify
  instead of aliasing: the instrumenter's `Ast` module now re-exports the
  interface's vocabulary rather than carrying a parallel `Built` derivation
  (grep the module for `export type \*` — the re-export must be the only
  vocabulary source).
- Run the package's `api:check` after rebuilding: api-extractor re-rolls the
  report against the externalized surface.

## Prevention

After any change that moves types across packages or edits dependency blocks,
probe every emitted `dist/*.d.ts` on the seam for external references to the
types-only package before running consumers' typechecks. A duplicate
derivation of the same vocabulary is the same hazard one rename apart —
prefer re-export over a second `Built`.
