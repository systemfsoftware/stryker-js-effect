# @systemfsoftware/stryker-js-instrumenter

AST mutation and mutant placement engine powered by OXC parser and ESTree code generator.

## Rules

| ID      | Obligation                                                                               | Gate                                                                          |
| ------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **IN1** | Zero Babel dependencies across dependency graph; no `plugins` configuration option       | `git grep -in babel -- packages/stryker-js-instrumenter/src/` returns 0 lines |
| **IN2** | AST printer alterations must pass characterization test suite                            | `pnpm --filter @systemfsoftware/stryker-js-instrumenter test`                 |
| **IN3** | TypeScript compilation and oxlint pass with zero warnings or errors                      | `pnpm --filter @systemfsoftware/stryker-js-instrumenter typecheck lint`       |
| **IN4** | Mutation placers must enforce AST validity in `canPlace` before mutant creation          | `review`                                                                      |
| **IN5** | `oxc-parser` imported dynamically on demand (`loadOxc`), never statically at module root | `review`                                                                      |

### Calibration pairs

- **IN4** — `wrong:` placer mutates expression without checking if enclosing statement supports mutant syntax; `right:` placer implements `canPlace` returning `false` for incompatible parent AST structures.
- **IN5** — `wrong:` `import { parseSync } from 'oxc-parser'` at top of file; `right:` `const { parseSync } = yield* loadOxc`.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-instrumenter build
pnpm --filter @systemfsoftware/stryker-js-instrumenter typecheck
pnpm --filter @systemfsoftware/stryker-js-instrumenter lint
pnpm --filter @systemfsoftware/stryker-js-instrumenter test
pnpm --filter @systemfsoftware/stryker-js-instrumenter attw
```
