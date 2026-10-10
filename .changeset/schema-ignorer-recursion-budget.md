---
"@systemfsoftware/stryker-ignorer-effect-schema-declarations": minor
---

A `recursionBudget` annotation on a recursive schema is no longer mutated, so a run over a project using `@systemfsoftware/effect-schema-recursion-budget` no longer fails its dry run with `Budget_RequiresTransform`. Both the annotate object holding the budget and the budget value are reported as `Ignored`.

Every reason the ignorer reports now starts with a stable code, as `effect-schema-declarations/<code>: <why>`. `REASON_CODES` maps each code to what it means, and `KEEP_IGNORED_MUTANT` says how to keep a mutant the ignorer removes.

Breaking: the exported reason constants (`BRAND_NAME_IGNORED`, `TYPE_ID_IGNORED`, and the rest) now hold the coded text. Code that compares against the old text must use the constants or match on the code.
