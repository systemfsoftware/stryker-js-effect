# AGENTS.md — `@systemfsoftware/stryker-js-language`

The mutation-testing language: enumerated concept modules, no platform.

## Rules

| ID      | Rule                                                    | Gate                                                                           |
| ------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **SL1** | Public specifiers are enumerated in `tsdown.config.ts`. | `pnpm --filter @systemfsoftware/stryker-js-language build` regenerates cleanly |
| **SL3** | The option set is one Effect Schema on `./Schema`.      | `review`                                                                       |

Plugin declaration (`declarePlugin`) lives in `@systemfsoftware/stryker-js-plugin-interface`.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-language build
pnpm --filter @systemfsoftware/stryker-js-language typecheck
pnpm --filter @systemfsoftware/stryker-js-language test
pnpm --filter @systemfsoftware/stryker-js-language lint
```
