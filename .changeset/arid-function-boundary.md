---
"@systemfsoftware/stryker-js-instrumenter": major
---

A mutant inside a function is no longer arid because of a call around that function. `Logger.make((options) => ...)` and the body of `Effect.withSpan(Effect.gen(function* () { ... }), 'span')` are mutated again; the `'span'` name is still Ignored. Every non-function argument of `Effect.fn` is Ignored as `arid-telemetry: Effect.fn`, whatever form the span name takes (string, template literal or member expression); the function body is mutated. The `arid-time` entry for `Date.now` is removed: `Date.now()` takes no arguments, so it never matched a mutant. Set `mutator.mutantSetPolicy: 'full'` to keep every arid mutant.
