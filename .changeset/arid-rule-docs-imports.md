---
"@systemfsoftware/stryker-js-plugin-interface": patch
---

The `IgnoreRuleId` descriptions for the `arid-*` rules now say that the callee must come from an `effect` import under any local name, or be `console` when nothing in scope rebinds or imports it, and that a call around a function never covers a mutant inside it, while a call inside that function still does. `arid-telemetry` covers every non-function argument of `Effect.fn`; `arid-time` no longer lists `Date.now`.
