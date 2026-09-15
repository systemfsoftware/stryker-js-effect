# @systemfsoftware/stryker-ignorer-effect-schema-declarations

Stryker ignorer plugin: suppresses equivalent mutants on Effect Schema brands, tags, and field defaults.

## Rules

| ID        | Obligation                                                                        | Gate                                                                             |
| --------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **SP1**   | Ignored mutant patterns must be proven equivalent                                 | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations test` |
| **SP2**   | New ignore patterns require accompanying test fixture                             | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations test` |
| **SP3**   | Export plugin exclusively via `strykerIgnorers` protocol                          | `review`                                                                         |
| **SP4**   | Zero `effect` or `@effect/*` imports across source or dependencies                | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations lint` |
| **SP5**   | Decision cases pinned strictly via snippet case tables; zero FastCheck generators | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations lint` |
| **SP6**   | Tests assert expected outcomes against explicit oracles, never snapshots          | `review`                                                                         |
| **COV-1** | 100% test coverage across `src/` (lines, branches, functions, statements)         | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations test` |

### Calibration pairs

- **SP3** — `wrong:` exporting mutator or reporter hooks; `right:` exporting `strykerIgnorers` descriptor list.
- **SP6** — `wrong:` using `toMatchSnapshot()`; `right:` asserting explicit ignored AST span and reason string.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations test
pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations lint
```
