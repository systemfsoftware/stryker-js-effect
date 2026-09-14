---
"@systemfsoftware/stryker-js-language": minor
---

`IgnorerService.shouldIgnore` now receives `(node, ancestors)` — the node and its
ancestors as typed positions from the ignorer contract — instead of a
`NodePath`. The `NodePath` re-export is gone; the node vocabulary comes from
`@systemfsoftware/stryker-ignorer-interface`, which this package now declares as
a dependency.
