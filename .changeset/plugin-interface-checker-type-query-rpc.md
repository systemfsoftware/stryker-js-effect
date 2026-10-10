---
"@systemfsoftware/stryker-js-plugin-interface": major
---

`Plugin.CheckerRpcs` gains two RPCs. `capabilities` takes a checker name and returns the checker's `CheckerCapabilities`, the type-query versions it serves. `typeQuery` takes a `TypeQueryRequest` and returns a `TypeQueryResponse` or fails with `TypeQueryRefused`.

Breaking for checker plugin authors: a checker worker's `CheckerRpcs.toLayer` handlers must now answer `capabilities` and `typeQuery`. A checker that serves no type queries answers `capabilities` with `{ typeQuery: [] }` and fails every `typeQuery` with `TypeQueryRefused` and reason `unsupported-version`.
