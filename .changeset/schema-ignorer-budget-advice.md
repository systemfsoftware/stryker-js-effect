---
"@systemfsoftware/stryker-ignorer-effect-schema-declarations": patch
---

The two `recursion-budget` reasons now say what they really mean, and the advice for keeping their mutants is correct.

- The `recursion-budget` reason calls `recursionBudget` metadata that only the recursion-budget transform, its runtime and the schema recursion laws read. The `recursion-budget-holder` reason says the object is ignored only when its other keys are all documentation.
- New `KEEP_ADVICE` maps every reason code to the next action that keeps its mutants tested. For the two budget codes it is `KEEP_RECURSION_BUDGET_MUTANT`: removing the ignorer fails the dry run with `Budget_RequiresTransform`, so remove the `recursionBudget` annotation instead. Every other code keeps `KEEP_IGNORED_MUTANT`.
