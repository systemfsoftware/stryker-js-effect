---
"@systemfsoftware/stryker-js-plugin-interface": patch
---

The `IgnoreRuleId` descriptions for the `arid-*` rules now say that the callee must come from an `effect` import under any local name, that `console` and `Date` count only when nothing in scope rebinds them, and that `arid-telemetry` covers the span name and options of `Effect.fn('name', options)`.
