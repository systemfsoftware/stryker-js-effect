# @systemfsoftware/stryker-ignorer-effect-schema-declarations

## Rules

| ID        | Obligation                                                                        | Gate                                                                             |
| --------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **SP1**   | Ignored mutant patterns must be proven equivalent                                 | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations test` |
| **SP4**   | Zero `effect` or `@effect/*` imports across source or dependencies                | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations lint` |
| **SP5**   | Decision cases pinned strictly via snippet case tables; zero FastCheck generators | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations lint` |
| **COV-1** | 100% test coverage across `src/`                                                  | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations test` |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations test
pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations lint
```
