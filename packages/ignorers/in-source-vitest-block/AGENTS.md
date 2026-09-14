# AGENTS.md — `@systemfsoftware/stryker-ignorer-in-source-vitest-block`

Stryker ignorer for in-source Vitest blocks: removes mutants inside an `if (import.meta.vitest)` guard. The guards are Standard Schema validators declared beside the decisions, and the package's only runtime dependency is `@systemfsoftware/stryker-ignorer-interface` — zero Effect is part of its identity. Root `AGENTS.md` governs.

## Rules

| ID      | Rule                                                                                                                                          | Gate                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **SP1** | An ignored mutant is unreachable in a mutation run: it lives inside an `if (import.meta.vitest)` block — test code, not production behaviour. | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test` |
| **SP2** | Every new ignore pattern arrives with a test demonstrating the unreachable mutant.                                                            | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test` |
| **SP3** | Register through the plain ignorer protocol only; never bypass other mutation stages.                                                         | `review`                                                                     |
| **SP4** | No `effect` or `@effect/*` import in any source or built file — the preset's `no-restricted-imports` ban is the gate.                         | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block lint` |
| **SP5** | No `effect` or `@effect/*` key in any dependency block; the interface package is the only runtime dependency.                                 | `review`                                                                     |
| **SP6** | Every behavior is pinned by a case table — no FastCheck generator and no snapshot call in a committed test.                                   | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block lint` |

The reviewer's decision on each `review`-gated row, shown as `wrong:`/`right:`:

- **SP3** — `wrong:` registering a checker or runner contribution beside the ignorer; `right:` `src/mod.ts` exports `strykerIgnorers` and nothing that answers another mutation stage.
- **SP5** — `wrong:` `"effect": "catalog:"` in `dependencies` or anywhere under `devDependencies`; `right:` `"@systemfsoftware/stryker-ignorer-interface": "workspace:^"` as the only runtime entry.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test
pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block lint
```
