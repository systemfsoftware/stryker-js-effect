---
"@systemfsoftware/stryker-js-typescript-checker": minor
---

Adds a provisional `./type-query` entry exposing `layer`, a `Layer` for the `TypeQuery` service of `@systemfsoftware/stryker-js-plugin-interface`, with one TypeScript server per `tsconfigFile`. Each candidate gets `Assignable`, `NotAssignable`, or `Unknown` with a reason. `NotAssignable` comes only where a declared type is enforced against the site: under an object spread or a non-null assertion, or on the right of `??`, `||` or `&&` when the left operand's type keeps that side out of the result, the answer is `Unknown` with reason `context-not-enforced`. A version-2 `function-body` site is `NotAssignable` when `undefined` cannot be the declared return type. The worker serves the same answers through the `typeQuery` RPC and declares versions 1 and 2 through `capabilities`.
