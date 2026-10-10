---
"@systemfsoftware/stryker-js-plugin-interface": minor
---

New provisional `./type-query` entry: the type-query port (`TypeQuery` service tag and the schema-version-1 `TypeQueryRequest`, `TypeQueryResponse`, `TypeAnswer` and `TypeQueryRefused` shapes). An instrumenter can ask through it, before generating a mutant, the type at a site and whether a candidate replacement is assignable there. The entry is provisional and will change shape when its consumer confirms it; that change ships as an ordinary break.
