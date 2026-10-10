---
"@systemfsoftware/stryker-framework-interface": minor
---

The AST vocabulary has one import path: this package no longer re-exports the types of `@systemfsoftware/stryker-ignorer-interface`.

Breaking:

- Import `Node`, `Program`, `Statement` and every other type of `@systemfsoftware/stryker-ignorer-interface` from that package, not from this one. The types this package declares itself are unchanged.
