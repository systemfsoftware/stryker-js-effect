# @systemfsoftware/stryker-test-contribution

Hygiene evaluator plugin: verifies test suites contribute distinct mutant kills without redundancy.

## Rules

| ID      | Obligation                                                                                                             | Gate                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **TC1** | Evaluation failure returns `ExitClass.VerdictFail` on success channel; `EvaluatorFailed` reserved for internal crashes | `pnpm --filter @systemfsoftware/stryker-test-contribution test` |
| **TC2** | Plugin activated via configuration; must not be imported directly by engine or CLI                                     | `review`                                                        |

### Calibration pairs

- **TC2** — `wrong:` engine imports `stryker-test-contribution` in module graph; `right:` plugin loaded dynamically via Stryker plugin options array.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-test-contribution typecheck
pnpm --filter @systemfsoftware/stryker-test-contribution test
pnpm --filter @systemfsoftware/stryker-test-contribution lint
```
