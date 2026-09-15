# @systemfsoftware/stryker-ignorer-in-source-vitest-block

Stryker ignorer plugin: removes mutants inside `if (import.meta.vitest)` in-source test guards.

## Rules

| ID        | Obligation                                                                        | Gate                                                                         |
| --------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **SP1**   | Only mutants inside `if (import.meta.vitest)` conditional blocks may be ignored   | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test` |
| **SP2**   | New ignore patterns require accompanying test fixture                             | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test` |
| **SP3**   | Export plugin exclusively via `strykerIgnorers` protocol                          | `review`                                                                     |
| **SP4**   | Zero `effect` or `@effect/*` imports across source or dependencies                | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block lint` |
| **SP5**   | Dependencies restricted to `@systemfsoftware/stryker-ignorer-interface` and `kit` | `review`                                                                     |
| **SP6**   | Decision cases pinned strictly via snippet case tables; zero FastCheck generators | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block lint` |
| **COV-1** | 100% test coverage across `src/` (lines, branches, functions, statements)         | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test` |

### Calibration pairs

- **SP3** — `wrong:` registering custom runner or mutator hooks; `right:` exporting `strykerIgnorers` entrypoint.
- **SP5** — `wrong:` adding external AST utilities to `dependencies`; `right:` using parser abstractions provided by `kit`.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test
pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block lint
```
