---
"@systemfsoftware/stryker-js-typescript-checker": minor
---

Adds a provisional `./type-query` entry exposing `TypeQueryLive`, a `Layer` for the `TypeQuery` service of `@systemfsoftware/stryker-js-plugin-interface/type-query`. It answers on its own TypeScript server per `tsconfigFile`, closed with the layer's scope; a server crash refuses only the file in flight. Each candidate replacement gets `Assignable`, `NotAssignable`, or `Unknown` with a reason. `NotAssignable` comes only where a declared type enforces the context (an annotation, assignment, `satisfies`, or an argument of a single non-generic signature); elsewhere the answer is `Unknown`, reason `context-not-enforced` or `overloaded-or-generic-call`.
