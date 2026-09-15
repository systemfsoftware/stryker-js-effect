# @systemfsoftware/stryker-ignorer-in-source-vitest-block

## Rules

| ID        | Obligation                                                                        | Gate                                                                         |
| --------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **SP1**   | Only mutants inside `if (import.meta.vitest)` conditional blocks may be ignored   | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test` |
| **SP4**   | Zero `effect` or `@effect/*` imports across source or dependencies                | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block lint` |
| **SP6**   | Decision cases pinned strictly via snippet case tables; zero FastCheck generators | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block lint` |
| **COV-1** | 100% test coverage across `src/`                                                  | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test` |
