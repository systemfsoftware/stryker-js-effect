# packages/ignorers

Plugins that suppress equivalent or un-actionable mutants during AST instrumentation.

## Boundaries

- Packages under this scope must not import `effect` or `@effect/*`.
- Ignorers must communicate strictly via the `@systemfsoftware/stryker-ignorer-interface` protocol (types-only).
- The root entry of `@systemfsoftware/stryker-ignorer-kit` must remain parser-free (parser dependencies isolated to `./tester`).
- Ignorers must be authored using `@systemfsoftware/stryker-ignorer-kit` and tested against deterministic source snippet tables (no FastCheck, no snapshots).
- All ignored mutant patterns must be proven equivalent. One ruled exception: `effect-schema-declarations` ignores a `recursionBudget` value in a Schema `annotate`/`annotations` object as test/generation-only metadata. Its only readers are `@systemfsoftware/effect-schema-recursion-budget` (build transform and runtime) and the recursion laws of `@systemfsoftware/effect-schema-law`; a production reader voids it. Gate: review — the reviewer rejects an ignored pattern that is neither proven equivalent nor this exception. wrong: ignoring `toEquivalence` beside a budget. right: ignoring `{ maxDepth: 6 }` under `recursionBudget`.
