---
"@systemfsoftware/stryker-framework-interface": minor
---

First release. This is the contract a framework plugin is written against: the
format it claims (`formatId`, `extensions`, `language`, `ownerVersion`,
`contractVersion`), the embedded document and script regions its parse produces,
and the `FrameworkContext` toolkit its hooks receive — `parseScript`,
`transformScript`, `printScript`, `instrumentationHeader`.

`ownerVersion` is the framework runtime the plugin resolved; the host stamps it
into incremental state, so upgrading that runtime invalidates remembered mutant
results. `contractVersion` is the interface version the plugin targets. The AST
types are the ones the ignorer interface exports. The package ships types only
and depends on no runtime.
