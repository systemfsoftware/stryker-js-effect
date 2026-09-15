---
'@systemfsoftware/stryker-ignorer-in-source-vitest-block': minor
---

Removed the `decideInSourceTestIgnore` and `isInSourceTestGuard` exports. The ignorer still
registers under the name `in-source-vitest-block` with unchanged recognized guard shapes and
unchanged ignore reasons. If you called the decision function directly, consult the
descriptor instead: `strykerIgnorers[0].shouldIgnore(node, ancestors)`.
