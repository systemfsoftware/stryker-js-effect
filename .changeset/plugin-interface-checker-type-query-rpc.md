---
"@systemfsoftware/stryker-js-plugin-interface": minor
---

`Plugin.CheckerRpcs` gains two RPCs. `capabilities` takes a checker name and returns the checker's `CheckerCapabilities`, the type-query versions it serves. `typeQuery` takes a `TypeQueryRequest` and returns a `TypeQueryResponse` or fails with `TypeQueryRefused`. A checker worker that does not declare a version serves no type query for it.
