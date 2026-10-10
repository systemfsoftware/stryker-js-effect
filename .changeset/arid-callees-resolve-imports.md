---
"@systemfsoftware/stryker-js-instrumenter": major
---

Arid rules now resolve the callee through the file's `effect` imports instead of matching its text. `E.logInfo('x')` after `import * as E from 'effect/Effect'` or `import * as E from 'effect'` (as `E.Effect.logInfo`) is Ignored as `arid-logging: Effect.logInfo`. A bare named import from `effect/Logger`, `effect/Metric`, `effect/Schedule` or `effect/Duration` now counts like the namespace form: `counter('requests')` after `import { counter } from 'effect/Metric'` is Ignored as `arid-telemetry: Metric.counter`. A local or imported `Effect`, `console` or `Date`, or an `Effect` that is never imported, is no longer arid, so its arguments are mutated again.
