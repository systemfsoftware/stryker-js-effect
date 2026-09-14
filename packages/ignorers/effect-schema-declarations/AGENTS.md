# AGENTS.md — `@systemfsoftware/stryker-ignorer-effect-schema-declarations`

Stryker ignorer for Effect Schema declarations: removes proven-equivalent mutants on brands, `TaggedClass`/`TaggedError` tags and field schemas, `optionalWith` defaults, and documentation annotations. Root `AGENTS.md` governs.

## Rules

| ID      | Rule                                                                                              | Gate                                                                             |
| ------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **SP1** | An ignored mutant is proven-equivalent: mutating the tag/brand field produces identical behavior. | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations test` |
| **SP2** | Every new ignore pattern arrives with a test demonstrating the equivalent mutant.                 | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations test` |
| **SP3** | Register through the plain ignorer protocol only; never bypass other mutation stages.             | `review`                                                                         |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations test
pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations lint
```
