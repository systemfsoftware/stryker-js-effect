# AGENTS.md — `@systemfsoftware/stryker-ignorer`

The plain ignorer contract: `PlainIgnorer`, `NodePath`, `ancestorsOf`, and the
vendored `StandardSchemaV1` interface. Zero runtime dependencies is the
package's identity — nothing that imports effect or a host package at run
time may land here. Root `AGENTS.md` governs.

## Rules

| ID      | Rule                                                                                                                       | Gate                                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **SI1** | The published surface stays plain: no effect type and no host-package type appears on any exported signature.              | `pnpm --filter @systemfsoftware/stryker-ignorer test` |
| **SI2** | An ignorer's absence is never a reason: `shouldIgnore` returns a reason string or `undefined`, nothing else.               | `pnpm --filter @systemfsoftware/stryker-ignorer test` |
| **SI3** | Every contract change is additive and structural — an ignorer built against an older contract still type-checks and loads. | `review`                                              |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer typecheck
pnpm --filter @systemfsoftware/stryker-ignorer test
pnpm --filter @systemfsoftware/stryker-ignorer lint
```
