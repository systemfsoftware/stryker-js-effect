# @systemfsoftware/stryker-test-contribution

## Rules

| ID      | Obligation                                                                                                             | Gate                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **TC1** | Evaluation failure returns `ExitClass.VerdictFail` on success channel; `EvaluatorFailed` reserved for internal crashes | `pnpm --filter @systemfsoftware/stryker-test-contribution test` |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-test-contribution typecheck
pnpm --filter @systemfsoftware/stryker-test-contribution test
pnpm --filter @systemfsoftware/stryker-test-contribution lint
```
