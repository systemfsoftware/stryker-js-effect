# @systemfsoftware/stryker-js-instrumenter

## Rules

| ID      | Obligation                                                           | Gate                                                                    |
| ------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **IN1** | Zero Babel dependencies across dependency graph; no `plugins` option | `git grep -in babel -- packages/stryker-js-instrumenter/src/`           |
| **IN2** | AST printer alterations pass characterization test suite             | `pnpm --filter @systemfsoftware/stryker-js-instrumenter test`           |
| **IN3** | Typecheck and oxlint pass with zero errors                           | `pnpm --filter @systemfsoftware/stryker-js-instrumenter typecheck lint` |
