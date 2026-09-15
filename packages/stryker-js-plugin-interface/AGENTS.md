# @systemfsoftware/stryker-js-plugin-interface

## Rules

| ID       | Obligation                                                      | Gate                                                                   |
| -------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **SJP1** | Public exports enumerated in `tsdown.config.ts`                 | `pnpm --filter @systemfsoftware/stryker-js-plugin-interface build`     |
| **SJP2** | Plugins declared via `declarePlugin` contributing typed `Layer` | `pnpm --filter @systemfsoftware/stryker-js-plugin-interface typecheck` |
