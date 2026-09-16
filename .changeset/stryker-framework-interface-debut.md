---
"@systemfsoftware/stryker-framework-interface": minor
---

First release. This is the contract a framework plugin is written against: the
format it claims (`formatId`, `extensions`, `language`, `ownerVersion`,
`contractVersion`), the embedded document and script regions its parse produces,
and the `FrameworkContext` toolkit the core hands its hooks — `parseScript`,
`transformScript`, `printScript`, `instrumentationHeader`. The claim names two
versions: `ownerVersion` is the framework runtime the plugin resolved and owns,
which the engine stamps into incremental state so upgrading that runtime
invalidates the mutant results an earlier run remembered, and `contractVersion`
is the interface version the plugin was written against. The AST vocabulary is
re-exported from the ignorer interface package rather than re-derived, so a
plugin and the core that calls it name the same node types. Nothing here runs,
and nothing depends on Effect, so adopting the contract costs nothing beyond the
types.
