---
"@systemfsoftware/stryker-ignorer-effect-schema-declarations": minor
---

First release. This ignorer keeps mutants inside Effect Schema declarations out of
a mutation run: a symbol, a tagged error, an annotation or a class body only
declares a type, so no run can observe the change.

It has no runtime dependencies, and migrating from the plugin you use today is a
rename in your plugins list — the ignorer keeps the name it already had.
