# @systemfsoftware/stryker-ignorer-kit

## Rules

| ID        | Obligation                                                          | Gate                                                      |
| --------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| **IK2**   | Zero `effect` or `@effect/*` dependencies across source or manifest | `pnpm --filter @systemfsoftware/stryker-ignorer-kit lint` |
| **COV-1** | Test coverage across `src/` must reach 100%                         | `pnpm --filter @systemfsoftware/stryker-ignorer-kit test` |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-kit build
pnpm --filter @systemfsoftware/stryker-ignorer-kit typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-kit test
pnpm --filter @systemfsoftware/stryker-ignorer-kit lint
pnpm --filter @systemfsoftware/stryker-ignorer-kit attw
```
