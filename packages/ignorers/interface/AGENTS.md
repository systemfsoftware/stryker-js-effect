# AGENTS.md — `@systemfsoftware/stryker-ignorer-interface`

The ignorer interface: `PlainIgnorer` with its declared `schema`, the Standard
Schema toolkit, the canonical ESTree vocabulary, `NodePath`, `ancestorsOf`, and
the `./testing` harness. Zero runtime dependencies and zero Effect is the
package's identity — nothing that imports effect or a host package, at run time
or in `devDependencies`, may land here. Root `AGENTS.md` governs.

## Rules

| ID      | Rule                                                                                                                               | Gate                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **SI1** | No `effect` or `@effect/*` import in any source or built file — the preset's `no-restricted-imports` ban is the gate.              | `pnpm --filter @systemfsoftware/stryker-ignorer-interface lint` |
| **SI2** | No `effect` or `@effect/*` key in any dependency block of `package.json`.                                                          | `review` — the reviewer reads the dependency blocks             |
| **SI3** | The published surface stays plain: no effect type and no host-package type appears on any exported signature.                      | `pnpm --filter @systemfsoftware/stryker-ignorer-interface test` |
| **SI4** | Validators are synchronous: `validate` returns a result, never a promise. Composition throws on a thenable instead of awaiting it. | `pnpm --filter @systemfsoftware/stryker-ignorer-interface test` |
| **SI5** | An ignorer's absence is never a reason: `shouldIgnore` returns a reason string or `undefined`, nothing else.                       | `pnpm --filter @systemfsoftware/stryker-ignorer-interface test` |
| **SI6** | Every behavior is pinned by a case table through `IgnoreTester` — no FastCheck generator and no snapshot call in a committed test. | `pnpm --filter @systemfsoftware/stryker-ignorer-interface lint` |
| **SI7** | Every contract change is additive and structural — an ignorer built against an older contract still type-checks and loads.         | `review`                                                        |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-interface build
pnpm --filter @systemfsoftware/stryker-ignorer-interface typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-interface test
pnpm --filter @systemfsoftware/stryker-ignorer-interface lint
pnpm --filter @systemfsoftware/stryker-ignorer-interface attw
```
