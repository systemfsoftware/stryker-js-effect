# @systemfsoftware/stryker-js-vitest-runner

Vitest test-runner plugin for Stryker mutation testing sandboxes.

## Rules

| ID      | Obligation                                                                  | Gate                                                                                                     |
| ------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **VR1** | Sandbox directory must be configured as project root                        | `review`                                                                                                 |
| **VR2** | `src/stryker-setup.ts` must contain zero relative or local imports          | `git grep -n "^import" packages/stryker-js-vitest-runner/src/stryker-setup.ts` returns no relative paths |
| **VR3** | Zero type-suppression comments and zero non-null assertions in source files | `pnpm --filter @systemfsoftware/stryker-js-vitest-runner typecheck`                                      |

### Calibration pairs

- **VR1** — `wrong:` runner creates nested temporary sandbox subdirectory; `right:` runner executes tests directly in designated workspace root sandbox.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-vitest-runner build
pnpm --filter @systemfsoftware/stryker-js-vitest-runner typecheck
pnpm --filter @systemfsoftware/stryker-js-vitest-runner lint
```
