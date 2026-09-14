---
"@systemfsoftware/stryker-ignorer-interface": minor
---

first release: the plain ignorer protocol — the `PlainIgnorer` descriptor (`{ name, schema, shouldIgnore }`, where `schema` is a Standard Schema validator declaring the AST input the ignorer decides over), the canonical ESTree node vocabulary as Standard Schema values, the structural `NodePath`, the `ancestorsOf` walker, a zero-dependency Standard Schema toolkit, and the `IgnoreTester` case-table harness on the `./testing` subpath — the package has zero runtime dependencies and no Effect dependency at all; ignorer authors migrating from `@systemfsoftware/stryker-plugins` export `strykerIgnorers` from their module instead of a `strykerPlugins` plugin array
