# packages/ignorers

Plugins that suppress equivalent or un-actionable mutants during AST instrumentation.

## Boundaries

- Packages under this scope must not import `effect` or `@effect/*`.
- Ignorers must communicate strictly via the `@systemfsoftware/stryker-ignorer-interface` protocol (types-only).
- The root entry of `@systemfsoftware/stryker-ignorer-kit` must remain parser-free (parser dependencies isolated to `./tester`).
- Ignorers must be authored using `@systemfsoftware/stryker-ignorer-kit` and tested against deterministic source snippet tables (no FastCheck, no snapshots).
- All ignored mutant patterns must be proven equivalent. One ruled exception: in the first argument of a Schema `annotate`/`annotations` call, `effect-schema-declarations` ignores the mutants inside a `recursionBudget` value as test/generation-only metadata, and the mutants of the object holding it, whatever its other keys, because the recursion-budget transform reads that object as a literal. Its only readers are `@systemfsoftware/effect-schema-recursion-budget` (build transform and runtime) and the recursion laws of `@systemfsoftware/effect-schema-law`; a production reader voids it. Gate: review — the reviewer rejects an ignored pattern that is neither proven equivalent nor this exception. wrong: ignoring the mutants inside `toEquivalence: () => eq` beside a budget. right: ignoring `{ maxDepth: 6 }` under `recursionBudget`, and the `{}` replacement of `{ recursionBudget: …, toEquivalence: … }`.
