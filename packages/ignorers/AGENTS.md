# packages/ignorers

Plugins that suppress equivalent or un-actionable mutants during AST instrumentation.

## Boundaries

- Packages under this scope must not import `effect` or `@effect/*`.
- Ignorers must communicate strictly via the `@systemfsoftware/stryker-ignorer-interface` protocol.
- New ignorer implementations must be authored using `@systemfsoftware/stryker-ignorer-kit` and tested against snippet tables.
