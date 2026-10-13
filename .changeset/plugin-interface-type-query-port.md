---
"@systemfsoftware/stryker-js-plugin-interface": minor
---

New provisional `TypeQuery` namespace: the type-query port (`TypeQuery` service tag and the `TypeQueryRequest`, `TypeQueryResponse`, `TypeAnswer` and `TypeQueryRefused` shapes). An instrumenter can ask through it, before generating a mutant, the type at a site and whether a candidate replacement is assignable there. Every site names its `kind`: version 1 asks `expression` sites, and version 2 adds the `function-body` site, which asks whether emptying that body compiles. A response carries the request's version. `CheckerCapabilities` and `typeQueryServingOf` tell a caller whether a checker serves a version. The namespace is provisional and will change shape when its consumer confirms it; that change ships as an ordinary break.
