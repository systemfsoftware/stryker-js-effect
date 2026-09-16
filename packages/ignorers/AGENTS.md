# packages/ignorers

Plugins that suppress equivalent or un-actionable mutants during AST instrumentation.

## Boundaries

- Packages under this scope must not import `effect` or `@effect/*`.
- Ignorers must communicate strictly via the `@systemfsoftware/stryker-ignorer-interface` protocol (types-only).
- The root entry of `@systemfsoftware/stryker-ignorer-kit` must remain parser-free (parser dependencies isolated to `./tester`).
- Ignorers must be authored using `@systemfsoftware/stryker-ignorer-kit` and tested against deterministic source snippet tables (no FastCheck, no snapshots).
- All ignored mutant patterns must be proven equivalent.
