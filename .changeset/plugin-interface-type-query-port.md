---
"@systemfsoftware/stryker-js-plugin-interface": minor
---

New provisional `./type-query` entry: the type-query port (`TypeQuery` service tag and the `TypeQueryRequest`, `TypeQueryResponse`, `TypeAnswer` and `TypeQueryRefused` shapes). An instrumenter can ask through it, before generating a mutant, the type at a site and whether a candidate replacement is assignable there. Version 1 asks expression sites; version 2 adds `TypeQuerySite.kind` and the `function-body` site, which asks whether emptying that body compiles. A response carries the request's version. `CheckerCapabilities` and `typeQueryServingOf` tell a caller whether a checker serves a version. The entry is provisional and will change shape when its consumer confirms it; that change ships as an ordinary break.
