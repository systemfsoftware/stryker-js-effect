# @systemfsoftware/stryker-js-vitest-runner

## Rules

| ID      | Obligation                                                  | Gate                                                                           |
| ------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **VR2** | `src/stryker-setup.ts` must contain zero relative imports   | `git grep -n "^import" packages/stryker-js-vitest-runner/src/stryker-setup.ts` |
| **VR3** | Zero type-suppression comments and zero non-null assertions | `pnpm --filter @systemfsoftware/stryker-js-vitest-runner typecheck`            |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-vitest-runner build
pnpm --filter @systemfsoftware/stryker-js-vitest-runner typecheck
pnpm --filter @systemfsoftware/stryker-js-vitest-runner lint
```
