# AGENTS.md — `@systemfsoftware/stryker-ignorer-effect-schema-declarations`

Stryker ignorer for Effect Schema declarations: removes proven-equivalent mutants on brands, `TaggedClass`/`TaggedError` tags and field schemas, `optionalWith` defaults, and documentation annotations. The ignorer is authored as typed visitors through `@systemfsoftware/stryker-ignorer-kit`, which compiles the visitor declaration to the wire contract; the package's dependencies are `@systemfsoftware/stryker-ignorer-interface` (node types, nothing that runs) and the kit. No Effect is imported, bundled, or depended on. Root `AGENTS.md` governs.

## Rules

| ID      | Rule                                                                                                                                                                                     | Gate                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **SP1** | An ignored mutant is proven-equivalent: mutating the tag/brand field produces identical behavior.                                                                                        | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations test` |
| **SP2** | Every new ignore pattern arrives with a test demonstrating the equivalent mutant.                                                                                                        | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations test` |
| **SP3** | Register through the plain ignorer protocol only; never bypass other mutation stages.                                                                                                    | `review`                                                                         |
| **SP4** | No `effect` or `@effect/*` import in any source or built file, and no `effect` or `@effect/*` key in any dependency block — the preset's `no-restricted-imports` ban is the import gate. | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations lint` |
| **SP5** | Every decision is pinned by a case table — a committed test carries no FastCheck generator.                                                                                              | `pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations lint` |
| **SP6** | A committed test asserts intended behavior, never a stored-output snapshot.                                                                                                              | `review`                                                                         |

SP3's reviewer decides one thing: whether the module reaches mutation through the plain ignorer protocol alone.

- `wrong:` exporting a StrykerJS plugin object, a reporter, or a mutator.
- `right:` exporting `strykerIgnorers`, the protocol the loader decodes.

SP6's reviewer decides one thing: whether every expected value is an oracle the decision under test did not produce.

- `wrong:` hand-built AST fixtures consulted node-by-node — they mirror the parser's output by hand and drift from it.
- `right:` source-snippet cases through `testIgnorer` — the real parser and walker decide, and each expectation names a source-text span and reason constant.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations test
pnpm --filter @systemfsoftware/stryker-ignorer-effect-schema-declarations lint
```
