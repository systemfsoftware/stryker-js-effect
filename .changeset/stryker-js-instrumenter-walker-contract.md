---
"@systemfsoftware/stryker-js-instrumenter": minor
---

`angularIgnorer`'s decision now receives `(node, ancestors)` — the node and its
ancestors as typed positions from the ignorer contract — instead of a path
object. The node vocabulary in this package's declarations is the one published
by `@systemfsoftware/stryker-ignorer-interface`, which is now a dependency.
