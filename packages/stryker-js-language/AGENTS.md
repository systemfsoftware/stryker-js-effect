# @systemfsoftware/stryker-js-language

## Rules

| ID      | Obligation                                       | Gate                                                           |
| ------- | ------------------------------------------------ | -------------------------------------------------------------- |
| **SL1** | Public exports enumerated in `tsdown.config.ts`  | `pnpm --filter @systemfsoftware/stryker-js-language build`     |
| **SL3** | Options declared via Effect Schema on `./Schema` | `pnpm --filter @systemfsoftware/stryker-js-language typecheck` |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-language build
pnpm --filter @systemfsoftware/stryker-js-language typecheck
pnpm --filter @systemfsoftware/stryker-js-language test
pnpm --filter @systemfsoftware/stryker-js-language lint
```
