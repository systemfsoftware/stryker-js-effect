---
title: The checker lost the program digest on a tsconfig extends resolved through package exports, so every CompileError was re-scored
date: 2026-10-09
category: performance-issues
module: stryker-js-typescript-checker
problem_type: performance_issue
component: tooling
symptoms:
  - "The incremental report carries `programDigest` on no CompileError record of a project, while another project in the same run has it on every one"
  - "Each Mutation run re-scores every CompileError mutant of that project, whatever changed"
  - "`stryker plan` schedules every CompileError mutant even when nothing changed"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [typescript-checker, program-digest, tsconfig-extends, package-exports, compile-error, incremental-reuse, shard-planning]
---

# The checker lost the program digest on a tsconfig extends resolved through package exports

## Problem

Main Mutation run 37862306027 recorded a program digest on 0 of 3564 CompileError verdicts in the stryker-js package and 0 of 256 in the TypeScript checker, against 103 of 103 in the vitest runner. A CompileError record without a digest is never reused (the `isCompileErrorRecord` branch of the incremental-diff reuse key), so those mutants were re-scored on every run. The plan never asked for a digest at all (`planRequest` passed `undefined` as the program digest), so it scheduled them too.

## Root cause

The checker digests the program, including its tsconfig `extends` chain. For a bare specifier, `tsConfigExtendsCandidatesOf` tried only literal paths under each ancestor `node_modules`. `@systemfsoftware/tsconfig/effect/entrypoint` has no file at that path: the package maps the subpath to another file through `package.json` `exports`. The digest failed with `CompilerFailed: tsconfig extends "@systemfsoftware/tsconfig/effect/entrypoint"`, and the engine's `programDigestOf` turned every failure into `undefined` without logging anything. The runner's tsconfig chain has no such extends, so only the runner kept its digests, and nothing in the report showed why the others had none.

TypeScript itself resolves `extends` through `exports`, so the type check worked; only the digest's own resolver was wrong.

## Solution

- A pure workflow, `resolvePackageExports`, resolves a subpath through an `exports` value (string, array, condition object, subpath map, single-`*` patterns; conditions `require`, `types`, `node`, `default`). The resolver tries that target first and falls back to the literal path.
- `programDigestOf(handle, project)` logs a warning naming the checker, the project and the reason for `CheckerFailed`, a crash, and out-of-memory, instead of returning `undefined` silently.
- `stryker plan` starts a one-slot checker pool when the previous report holds a CompileError record and passes its digest to the same `readIncrementalReuse` the run uses.

Regression tests: the checker's program-digest integration feature (a root tsconfig extending a base through a package subpath export; editing the base must move the digest) and the engine's CompileError-reuse integration feature (plan and run reuse CompileErrors for an unchanged program and re-score them after a program edit).

## Prevention

When a reuse key can be absent, count its absence per project in the run output. A key that is `undefined` on every record of one project and present on another's is a resolver failure, not a changed program. Here the failure was visible only by reading the report.

The digest covers the whole program, so an edit to any file in a project's program still re-scores every CompileError of that project. The fix helps runs where a project's program is unchanged; it does not narrow a source change to the edited file's mutants.
