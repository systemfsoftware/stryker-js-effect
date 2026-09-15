# @systemfsoftware/stryker-ignorer-interface

## Rules

| ID      | Obligation                                                                          | Gate                                                             |
| ------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **SI1** | Zero `effect` or `@effect/*` imports across source and types                        | `pnpm --filter @systemfsoftware/stryker-ignorer-interface lint`  |
| **SI3** | Types-only package: `dist/index.mjs` is empty and all exports are type declarations | `pnpm --filter @systemfsoftware/stryker-ignorer-interface build` |
| **SI5** | Published API surface matches `etc/stryker-ignorer-interface.api.md`                | `pnpm --filter @systemfsoftware/stryker-ignorer-interface build` |
| **SI6** | Type-level contracts verified via Vitest typecheck mode                             | `pnpm --filter @systemfsoftware/stryker-ignorer-interface test`  |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-interface build
pnpm --filter @systemfsoftware/stryker-ignorer-interface typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-interface test
pnpm --filter @systemfsoftware/stryker-ignorer-interface lint
pnpm --filter @systemfsoftware/stryker-ignorer-interface attw
```
