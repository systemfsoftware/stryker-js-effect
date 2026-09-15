# @systemfsoftware/stryker-js-language

Domain core for mutation testing: schemas, mutant models, exit codes, and result classifications.

## Rules

| ID      | Obligation                                                         | Gate                                                       |
| ------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| **SL1** | Public exports must be enumerated in `tsdown.config.ts`            | `pnpm --filter @systemfsoftware/stryker-js-language build` |
| **SL3** | All public options declared as unified Effect Schema on `./Schema` | `review`                                                   |

### Calibration pairs

- **SL3** — `wrong:` options parsed via untyped object cast or raw interfaces; `right:` options decoded and encoded using `Schema.Struct` and `Schema.TaggedError`.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-language build
pnpm --filter @systemfsoftware/stryker-js-language typecheck
pnpm --filter @systemfsoftware/stryker-js-language test
pnpm --filter @systemfsoftware/stryker-js-language lint
```
