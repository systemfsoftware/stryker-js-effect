---
"@systemfsoftware/stryker-ignorer-interface": minor
---

An ignorer's path is now `{ node, ancestors }`: the ancestors arrive as data, nearest first, so a
`shouldIgnore` implementation no longer walks a parent chain itself. The parent-path member is gone.

The AST vocabulary is now re-exported from `@oxc-project/types` under that package's own names and
bundled into this package's declarations, so nothing extra needs installing.
