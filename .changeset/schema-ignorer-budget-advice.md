---
"@systemfsoftware/stryker-ignorer-effect-schema-declarations": minor
---

A schema that annotates a `recursionBudget` beside a behaviour key such as `toEquivalence` no longer fails the dry run with `Budget_RequiresTransform`.

- The object holding a `recursionBudget` in the first argument of `annotate` or `annotations` is now ignored whatever its other keys are. The other keys' values are still mutated.
- The `recursion-budget` reason calls `recursionBudget` metadata that only the recursion-budget transform, its runtime and the schema recursion laws read. The `recursion-budget-holder` reason and `RECURSION_BUDGET_HOLDER_IGNORED` drop "beside documentation only".
- New `KEEP_ADVICE` maps every reason code to the next action that keeps its mutants tested: `KEEP_RECURSION_BUDGET_MUTANT` (remove the `recursionBudget` annotation) for the two budget codes, `KEEP_IGNORED_MUTANT` for the rest.
