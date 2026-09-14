---
"@systemfsoftware/stryker-ignorer-interface": minor
---

First release. This is the contract an ignorer is written against: the
`PlainIgnorer` descriptor (`{ name, shouldIgnore }`), the structural `NodePath`
an entry is called with, `UnknownNode`, `AstNodeType`, and the canonical AST
node vocabulary, aliased from the parser that produces those nodes.

The package ships no runtime value and no runtime dependencies, so adopting it
costs nothing beyond the types.
