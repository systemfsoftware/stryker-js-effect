---
title: Reporter sums overflowed to Infinity because their schemas admitted any finite number
date: 2026-11-15
category: logic-errors
module: stryker-js
problem_type: logic_error
component: reporters
severity: medium
applies_when:
  - a decision adds up counts or durations it decoded from a schema
  - a count or duration field is typed as any finite number, with no integer, sign or upper bound
  - a property test draws its inputs from the production schema rather than from hand-picked values
retire_when: "every count and duration schema in the plugin interface carries a sign and an upper bound, and no reporter adds up an unbounded field"
tags: [schema, overflow, infinity, reporters, property-testing, counts, durations]
---

# Reporter sums overflowed to Infinity because their schemas admitted any finite number

## Problem

The reporters add up counts and durations they decode from the plugin interface's schemas. Those fields were typed as any finite number (`Schema.Finite` or `NonNegativeFinite`), so a single value could be as large as `Number.MAX_VALUE`. Adding two such values gives `Infinity`.

- `Report.MutantResult.testsCompleted` was `Schema.Finite`. The clear-text reporter sums it over every mutant and divides by the mutant count for its "tests per mutant" line.
- `Reporter.RunTimingSchema` (`net`, `overhead`) and `Reporter.ReporterPlanDescriptorSchema.netTime` were `NonNegativeFinite`. The progress reporter adds a plan's net time and overhead into each mutant's ticks, adds those into the bar total, and adds them to the ticks done after each tested mutant.

## Symptoms

- The old clear-text arithmetic on two mutants with `testsCompleted: 1e308` gives `Ran Infinity tests per mutant on average.` `1e308` is finite, so the old schema decoded it. The sum `1e308 + 1e308` is `Infinity`, and `Infinity.toFixed(2)` is `"Infinity"`.
- The progress decision's property `∀e_KnownMutant_≡TickAdvancesTallyAndBar` failed with `PropertyError`. Its shrunk input had a tally with `ticks: 8.98128139290624e+292` and a planned tick of `1.797693134862315e+308`. Their sum is not a finite number, so the decision could not encode its own state.
- `∀e_PlanReady_≡BarKeyedByRunPlans` failed the same way on plans whose `netTime` was about `1.79e308`.
- `∀c_PresentReport_≡SummaryPayload` for the clear-text decision failed with an exception on summed `testsCompleted`.

## What Didn't Work

- **Typing the summed field as `S.Number`.** This lets `Infinity` through instead of rejecting it, and the repository's `schema-number` lint forbids `S.Number`.
- **An overflow decision variant.** This was rejected. It would give every reporter a branch for input that Stryker never produces, and it would only push the problem from the sum to the printer.
- **Ruling such inputs "out of contract" and leaving the schema alone.** This was rejected. If a schema decodes a value, that value is in the contract. A decision that cannot handle a decoded value is a bug in the schema or in the decision.
- **Narrowing the test inputs.** Bounded test-local arbitraries, filtering draws in the predicate, or a `maxLength` or generation constraint on the shared report schemas were all rejected. They hide the gap from the test while consumers can still decode the unbounded value.

## Solution

Bound the production schemas where the values are defined:

- **Counts.** `Report.MutantResult.testsCompleted`, `Mutant.testsCompleted` and the incremental files' `testsCompleted` are non-negative integers no larger than `Number.MAX_SAFE_INTEGER`. The bound on `testsCompleted` is applied in `scripts/report-contract.ts`, so the generated `src/generated/report.schema.ts` and the published `contract/report.schema.json` both carry it. The progress tally's `survived`, `timedOut`, `tested` and `mutants` are non-negative integers.
- **Durations.** `Reporter.DurationMs` is a non-negative number no larger than `Number.MAX_SAFE_INTEGER`, and it may be fractional because Stryker records fractional timings. `RunTimingSchema.net`, `RunTimingSchema.overhead` and `ReporterPlanDescriptorSchema.netTime` use it.
- **Sums.** Fields that hold a sum of bounded values, such as the progress `ticks`, `total` and bar position, stay non-negative finite numbers. Adding a bounded duration to any finite number cannot reach `Infinity`.

No decision changed. JSON reports written by Stryker still decode: the two full-package reports measured had at most 27 completed tests per mutant, and none of the values was fractional.

## Why This Works

Doubles stay exact and finite far beyond `Number.MAX_SAFE_INTEGER` (about 9.007e15). `Number.MAX_VALUE` is about 1.798e308, so a sum of bounded values would need roughly 10^292 terms to overflow. A reporter adds at most one term per mutant or plan. Every value the schemas decode can now be summed without reaching `Infinity`, so the decisions need no overflow branch.

## Prevention

- Give every count a non-negative integer type with an upper bound, and every duration a non-negative bound, wherever the field is declared. Do not leave it as "any finite number".
- Draw property inputs from the production schema that owns each field. The overflow was found only once the tests stopped using hand-built shapes and drew from the production schemas.
- When the schema comes from an upstream contract (mutation-testing-report-schema declares `testsCompleted` as any `number`), apply the bound in the generator's contract assembly, so the generated module and the published document agree.

## Related Issues

- The upstream mutation-testing-report-schema 3.9.0 accepts any `number` for `testsCompleted`. This package's published contract is now narrower, and its changeset records the stricter decode as a major change.
