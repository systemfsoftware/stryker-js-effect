---
"@systemfsoftware/stryker-js-typescript-checker": minor
---

Adds a provisional `./type-query` entry exposing `TypeQueryLive`, a `Layer` for the `TypeQuery` service of `@systemfsoftware/stryker-js-plugin-interface/type-query`, with its own TypeScript server per `tsconfigFile`. Each candidate gets `Assignable`, `NotAssignable`, or `Unknown` with a reason; `NotAssignable` comes only where a declared type enforces the context. A version-2 `function-body` site is `NotAssignable` when `undefined` cannot be the declared return type, `Assignable` when that type is `void`, `undefined` or `any`, and `Unknown` with a named reason otherwise. The worker serves the same answers through the `typeQuery` RPC and declares versions 1 and 2 through `capabilities`; its query server starts on the first query and stops with the worker.
