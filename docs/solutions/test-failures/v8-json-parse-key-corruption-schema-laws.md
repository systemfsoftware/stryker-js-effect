---
title: V8 JSON.parse key corruption in generated Effect Schema roundtrip laws
date: 2026-09-24
category: test-failures
module: stryker-js-plugin-runtime
problem_type: test_failure
component: testing_framework
severity: high
symptoms:
  - "Generated property law ∀x_WorkerOptionsWireEnc_=x fails intermittently on Node 24 at CI run budget while the shrunk counterexample passes when replayed in isolation"
  - "Decoded JSON record loses object keys or rewrites key names when arbitrary string generator produces keys with escaped backslashes"
root_cause: test_isolation
resolution_type: test_fix
framework_version: node 24.x / v8 13.6
tags: [effect-schema, vitest, v8, fast-check, json-parse, property-testing, seed-pin]
---

# V8 JSON.parse key corruption in generated Effect Schema roundtrip laws

## Problem

Generated Effect Schema roundtrip property laws in `packages/stryker-js-plugin-runtime` (`∀x_WorkerOptionsWireEnc_=x` and `∀x_WorkerOptionsWire_=x`) failed intermittently in CI, failing in approximately 60% of test runs on Node 24 at the CI property-run budget.

When the property test runner shrunk the failure to a minimal counterexample and the counterexample was replayed in isolation, the test passed. This gave the appearance of a non-deterministic schema law or a broken arbitrary generator rather than a real decode defect.

## Root Cause

The failure is caused by an upstream V8 engine bug tracked in `nodejs/node#63785`, present in Node 24.x and Node 26.x (a regression introduced between V8 12.4 and V8 13.6).

When `JSON.parse` evaluates an object where a key ends in an escaped backslash, a subsequent escaped key in the same parse stream can decode to an incorrect string or have its key dropped or overwritten in memory:

```
P(\text{corruption}) = 1 - (1 - P(\text{escaped backslash key}))^{N_{\text{keys}}}
```

The wire schema in `packages/stryker-js-plugin-runtime/src/worker-options.schema.ts` is defined as:

```ts
export const WorkerOptionsWire = S.fromJsonString(Options.StrykerOptionsSchema)
```

Because `StrykerOptionsSchema` contains an open record rest `[S.Record(S.String, S.Unknown)]`, the arbitrary generator synthesizes arbitrary unicode and escaped string keys for the dictionary properties. In test suites with large run budgets (such as 1,000 runs in CI), the arbitrary generator consistently produces keys ending in escaped backslashes, triggering the V8 parse corruption.

Furthermore, setting `fc.configureGlobal({ seed })` does not resolve the issue: Effect 4 (rc.117) schema laws run through Effect's internal arbitrary runner rather than fast-check's global runner configuration.

## Solution

To eliminate the non-deterministic CI failure without disabling schema roundtrip laws, the test runner infrastructure was updated to inject an explicit property seed into `@effect/vitest`:

1. In `packages/toolchain/vitest-config/lib/base.d.ts`, `propertySeed` is declared in Vitest's `ProvidedContext`:
   ```ts
   declare module 'vitest' {
     interface ProvidedContext {
       propertySeed: number
     }
   }
   ```

2. In `packages/toolchain/vitest-config/lib/base.js`, `@effect/vitest` and `@systemfsoftware/effect-schema-law` are listed in `modulesReachingTheBudgetedPropMock` so Vitest inlines them for the runner's property mock:
   ```ts
   const modulesReachingTheBudgetedPropMock = ['@effect/vitest', '@systemfsoftware/effect-schema-law']
   ```

3. In `packages/toolchain/vitest-config/lib/setup.js`, setup reads `inject('propertySeed')` and passes `{ seed }` to the underlying `it.prop` runner options:
   ```ts
   const propertySeed = inject('propertySeed')
   const seeded = propertySeed === undefined ? {} : { seed: propertySeed }
   ```

4. In `packages/stryker-js-plugin-runtime/vitest.config.ts`, `propertySeed` was provided with a verified seed:
   ```ts
   const seedAvoidingNodeIssue63785JsonParseKeyCorruption = 1
   ```
   Seed `1` was verified passing 5/5 at every property run budget (local 100, CI 1000, mutation worker 30), whereas an unpinned control seed (`7`) failed 5/5 runs.

## Current State

No property seed is pinned any more. The `propertySeed` hook left the shared Vitest config in #109, and the plugin-runtime pin was removed in #110, so every package runs its schema laws on unpinned seeds.

- The bug affects Node 24 and 26 (V8 12.8 and later). Node 22 (V8 12.4) is not affected.
- `packages/stryker-js/README.md` carries a **Known issues** entry for it: on Node 24 a long-lived process that has parsed an object key ending in an escaped backslash can misread a later escaped key, which affects tools that read Stryker report JSON in the same process.
- Generated `S.fromJsonString` laws over open-keyed records (for example `∀x_CountedReportJson_=x` and `∀x_KillMatrixReportJson_=x`, over the `CountedReportJson` and `KillMatrixReportJson` codecs) can still fail intermittently on Node 24 when an earlier value in the same worker parsed a backslash-ending key.
- **Removal Condition:** Remove the README known-issues entry, and expect these intermittent law failures to stop, once a Node 24 release carries the backport in [nodejs/node#66542](https://github.com/nodejs/node/pull/66542) (V8 fix `93cd21e825`).

## Prevention

When a generated JSON-string schema law fails intermittently and the counterexample passes when evaluated in isolation:

1. Suspect the V8 engine `JSON.parse` key-corruption bug before assuming the schema transform is invalid.
2. Measure failure incidence empirically across multiple seeds and budgets in the affected package rather than globally pinning all workspace projects.
