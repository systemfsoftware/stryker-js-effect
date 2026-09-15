---
"@systemfsoftware/stryker-framework-interface": minor
---

First release. This is the contract a framework plugin is written against: the
format it claims (`formatId`, `extensions`, `language`, `contractVersion`), the
embedded document and script regions its parse produces, and the
`FrameworkContext` toolkit the core hands its hooks — `parseScript`,
`transformScript`, `printScript`, `instrumentationHeader`. The AST vocabulary is
re-exported from the ignorer interface package rather than re-derived, so a
plugin and the core that calls it name the same node types. Nothing here runs,
and nothing depends on Effect, so adopting the contract costs nothing beyond the
types.
