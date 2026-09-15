# AGENTS.md — `@systemfsoftware/stryker-ignorer-in-source-vitest-block`

Stryker ignorer for in-source Vitest blocks: removes mutants inside an `if (import.meta.vitest)` guard. The ignorer is authored as typed visitors through `@systemfsoftware/stryker-ignorer-kit`, and the package's only runtime dependencies are `@systemfsoftware/stryker-ignorer-interface` (node types, nothing that runs) and the kit (authoring compile and tester) — zero Effect is part of its identity. Root `AGENTS.md` governs.

## Rules

| ID      | Rule                                                                                                                                          | Gate                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **SP1** | An ignored mutant is unreachable in a mutation run: it lives inside an `if (import.meta.vitest)` block — test code, not production behaviour. | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test` |
| **SP2** | Every new ignore pattern arrives with a test demonstrating the unreachable mutant.                                                            | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test` |
| **SP3** | Register through the plain ignorer protocol only; never bypass other mutation stages.                                                         | `review`                                                                     |
| **SP4** | No `effect` or `@effect/*` import in any source or built file — the preset's `no-restricted-imports` ban is the gate.                         | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block lint` |
| **SP5** | No `effect` or `@effect/*` key in any dependency block; the interface and kit packages are the only runtime dependencies.                     | `review`                                                                     |
| **SP6** | Every behavior is pinned by a snippet case table run through `testIgnorer` — no FastCheck generator and no snapshot call in a committed test. | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block lint` |
| **SP7** | Coverage of `src/**/*.ts` is measured on every test run and must reach 100% per file (lines, branches, functions, statements).                | `pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test` |

The reviewer's decision on each `review`-gated row, shown as `wrong:`/`right:`:

- **SP3** — `wrong:` registering a checker or runner contribution beside the ignorer; `right:` `src/mod.ts` exports `strykerIgnorers` and nothing that answers another mutation stage.
- **SP5** — `wrong:` `"effect": "catalog:"` in `dependencies` or anywhere under `devDependencies`; `right:` `"@systemfsoftware/stryker-ignorer-interface": "workspace:^"` and `"@systemfsoftware/stryker-ignorer-kit": "workspace:^"` as the only `dependencies` entries.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block test
pnpm --filter @systemfsoftware/stryker-ignorer-in-source-vitest-block lint
```
