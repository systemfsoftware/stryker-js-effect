---
"@systemfsoftware/stryker-js-typescript-checker": minor
---

Adds a `./type-query` entry exposing `TypeQueryLive`, a `Layer` that implements the `TypeQuery` service of `@systemfsoftware/stryker-js-plugin-interface/type-query`. It answers type queries on a separate TypeScript server, opened per `tsconfigFile` on first use and closed when the layer's scope closes; a server crash refuses only the file in flight, and the next file is answered on a fresh server. For each site it returns the site type and contextual type as text, and for each candidate replacement exactly one answer: `Assignable`, `NotAssignable`, or `Unknown` with a reason.

This entry is provisional: it changes shape when its consumer confirms it, and that change ships as an ordinary break.
