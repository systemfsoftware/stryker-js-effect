# AGENTS.md — `@systemfsoftware/stryker-js-plugin-interface`

The mutation-testing plugin interface: declaring and composing plugin
contributions. Parent: root `AGENTS.md`.

## Rules

| ID       | Rule                                                                                                                         | Gate                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **SJP1** | Public specifiers are enumerated in `tsdown.config.ts` (REPO-S4).                                                            | `pnpm --filter @systemfsoftware/stryker-js-plugin-interface build` regenerates cleanly |
| **SJP2** | A plugin is declared with `declarePlugin`: every kind contributes a `Layer`; the Reporter kind contributes a `make` factory. | `review`                                                                               |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-plugin-interface build
pnpm --filter @systemfsoftware/stryker-js-plugin-interface typecheck
pnpm --filter @systemfsoftware/stryker-js-plugin-interface test
pnpm --filter @systemfsoftware/stryker-js-plugin-interface lint
```
