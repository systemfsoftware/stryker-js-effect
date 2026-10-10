---
"@systemfsoftware/stryker-js-instrumenter": major
---

Arid rules now resolve the callee through the file's `effect` imports instead of matching its text. `E.logInfo('x')` after `import * as E from 'effect/Effect'`, and `logInfo('x')` after `import { logInfo } from 'effect/Effect'`, are Ignored as `arid-logging: Effect.logInfo`. A local object named `Effect`, `console` or `Date`, or an `Effect` that is never imported, is no longer treated as arid, so its arguments are mutated again. The span name and options of `Effect.fn('name', options)` are Ignored as `arid-telemetry: Effect.fn`; the function body passed to `Effect.fn` is still mutated. Set `mutator.mutantSetPolicy: 'full'` to keep every arid mutant.
