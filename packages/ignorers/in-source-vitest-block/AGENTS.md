# AGENTS.md — `@systemfsoftware/stryker-ignorer-in-source-vitest-block`

Stryker ignorer for in-source Vitest blocks: removes mutants inside an `if (import.meta.vitest)` guard. Root `AGENTS.md` governs.

## Rules

| ID      | Rule                                                                                                                                          | Gate                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **SP1** | An ignored mutant is unreachable in a mutation run: it lives inside an `if (import.meta.vitest)` block — test code, not production behaviour. | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test` |
| **SP2** | Every new ignore pattern arrives with a test demonstrating the unreachable mutant.                                                            | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test` |
| **SP3** | Register through the plain ignorer protocol only; never bypass other mutation stages.                                                         | `review`                                                                     |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test
pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block lint
```
