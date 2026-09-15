# @systemfsoftware/oxlint-ignorer-config

## Rules

| ID      | Obligation                                                                                         | Gate                                                             |
| ------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **OC1** | Cyclomatic complexity capped at 2 in `**/src/**`; ternary syntax permitted                         | `pnpm --filter @systemfsoftware/oxlint-ignorer-config lint`      |
| **OC2** | Disallow unchecked type casts (`never`), `no-unsafe-*`, `no-explicit-any`, and non-null assertions | `pnpm --filter @systemfsoftware/oxlint-ignorer-config lint`      |
| **OC3** | Disallow imports of `effect`, `@effect/*`, and `@systemfsoftware/stryker-js-*`                     | `pnpm --filter @systemfsoftware/oxlint-ignorer-config lint`      |
| **OC4** | Test files must not include focused tests or conditional assertions                                | `pnpm --filter @systemfsoftware/oxlint-ignorer-config lint`      |
| **OC5** | `lib/base.d.ts` must match API report in `etc/oxlint-ignorer-config.api.md`                        | `pnpm --filter @systemfsoftware/oxlint-ignorer-config api:check` |
| **OC6** | `lib/base.js` is typechecked; JSDoc `@type` annotations are load-bearing                           | `pnpm --filter @systemfsoftware/oxlint-ignorer-config typecheck` |

## Verification

```bash
pnpm --filter @systemfsoftware/oxlint-ignorer-config typecheck
pnpm --filter @systemfsoftware/oxlint-ignorer-config api:check
```
