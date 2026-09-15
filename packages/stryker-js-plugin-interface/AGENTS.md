# @systemfsoftware/stryker-js-plugin-interface

Shared plugin contracts and registration protocols for the Stryker mutation engine.

## Rules

| ID       | Obligation                                                                                         | Gate                                                               |
| -------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **SJP1** | Public exports must be enumerated in `tsdown.config.ts`                                            | `pnpm --filter @systemfsoftware/stryker-js-plugin-interface build` |
| **SJP2** | Plugins declared via `declarePlugin` contributing typed `Layer` (or `make` factory for `Reporter`) | `review`                                                           |

### Calibration pairs

- **SJP2** — `wrong:` plugin exports raw callback without typed `PluginKind` descriptor; `right:` plugin calls `declarePlugin` returning structured `Layer`.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-plugin-interface build
pnpm --filter @systemfsoftware/stryker-js-plugin-interface typecheck
pnpm --filter @systemfsoftware/stryker-js-plugin-interface test
pnpm --filter @systemfsoftware/stryker-js-plugin-interface lint
```
