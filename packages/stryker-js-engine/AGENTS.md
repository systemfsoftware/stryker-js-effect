# @systemfsoftware/stryker-js-engine

## Rules

| ID      | Obligation                                                                 | Gate                                                         |
| ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **EN1** | Zero `@effect/platform-*` in manifest and zero `engines` in `package.json` | `pnpm --filter @systemfsoftware/stryker-js-engine attw`      |
| **EN2** | `makeRunLayer` requires parameterized platform capabilities                | `pnpm --filter @systemfsoftware/stryker-js-engine typecheck` |
| **EN3** | Workers addressed strictly by `entryUrl` strings                           | `pnpm --filter @systemfsoftware/stryker-js-engine test`      |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-engine build
pnpm --filter @systemfsoftware/stryker-js-engine typecheck
pnpm --filter @systemfsoftware/stryker-js-engine test
pnpm --filter @systemfsoftware/stryker-js-engine lint
```
