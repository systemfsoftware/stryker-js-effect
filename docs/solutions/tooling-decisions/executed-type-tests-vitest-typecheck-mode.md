---
title: "Executed type tests: vitest typecheck mode runs .test-d assertions as tests, a tsc-only compile cannot"
date: 2026-09-15
category: tooling-decisions
module: stryker-js-effect ignorer packages
problem_type: tooling_decision
component: testing_framework
severity: medium
applies_when:
  - "a package's exported surface is types consumers compile against, and type-level contracts need a gate that can fail"
  - "a type-test file exists but the lane that should run it reports 'No test files found' with exit code 0"
  - "someone proposes grading `.test-d.ts` files by a bare `tsc --noEmit` task instead of the test lane"
tags: [type-testing, vitest-typecheck, expect-type-of, test-d-files, verification-gates]
---

# Executed type tests: vitest typecheck mode runs .test-d assertions as tests, a tsc-only compile cannot

## Context

Type tests in `*.test-d.ts` are statically analyzed, never executed. Leaving them to the
per-package `typecheck` task grades nothing: `tsc --noEmit` compiles the files incidentally,
`expectTypeOf`/`@ts-expect-error` assertions are invisible to it, and the lane reports
"No test files found, exiting with code 0" — a green gate with zero executed tests. The
interface package shipped in exactly that state. The decision (owner-directed in-session)
is the standard mechanism instead: vitest typecheck mode, per vitest's own testing-types
guide, which states the pipeline scripts become removable once it is on.

## Guidance

Enable the mode per package whose product is types — in the package's own vitest config,
not the shared toolchain config:

```ts
test: {
  ...sharedConfig.test,
  typecheck: { enabled: true },
}
```

Vitest then calls `tsc --noEmit` itself and reports type errors as test failures; the
default `typecheck.include` glob (`**/*.{test,spec}-d.?(c|m)[jt]s?(x)`) picks up the
`.test-d.ts` files — the package's runtime `test.include` is irrelevant to that pickup.
Assertions use `expectTypeOf(...)` for acceptance pins and `@ts-expect-error` for
refusals; a refusal comment must sit immediately above the offending line or tsc reports
both the unhidden error and an unused directive. Matcher choice is the oracle rule:
`toEqualTypeOf` for exact contracts (it is the only matcher that rejects `any` and
excess shape), `toExtend` only where the contract is genuinely one-way. Verified in this
workspace: `pnpm --filter @systemfsoftware/stryker-ignorer-interface test` reports
`Tests 6 passed` plus `Type Errors no errors` where the same lane previously reported no
test files, and a widened `shouldIgnore` signature in source fails the lane with type-test
failures.

Two costs and one dependency: each gated package's test run pays one `tsc` pass (about
1.5s on the kit package), vitest prints an experimental-feature warning and advises
pinning the runner version (this workspace pins `vitest: ^4` in the catalog), and turbo
must order `build` before `test` because the type tests resolve the package name through
its exports map — with the `types` key first, they observe the built declaration, so the
`@systemfsoftware/source` condition must precede `types` for the lane to grade source
(see `docs/solutions/tooling-decisions/workspace-source-condition-dev-resolution.md`).

## Applicability

Ship type tests only where types are the product — an authoring API and a vocabulary
package here; a package whose published surface is runtime values gains nothing and
should keep parameterized runtime tables. A lane with the mode enabled but zero matching
files still exits 0, so after wiring it, confirm the run reports the expected test count
and `Type Errors no errors` rather than trusting the green.
