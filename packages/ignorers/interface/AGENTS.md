# AGENTS.md — `@systemfsoftware/stryker-ignorer-interface`

The ignorer interface as types only: `Ignorer` — the descriptor whose decision
receives the node and its ancestors as typed positions — the AST vocabulary
re-exported from `@oxc-project/types` with optional spans and bundled into this
package's own declarations, and the `Walker` traversal types a host implements.
The package publishes no value, no function, and
no schema — a guard and a reason string belong to the ignorer that needs them.
Zero runtime dependencies and zero Effect is the package's identity — nothing
that imports effect or a host package, at run time or in `devDependencies`, may
land here. Root `AGENTS.md` governs.

## Rules

| ID      | Rule                                                                                                                                                     | Gate                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **SI1** | No `effect` or `@effect/*` import in any source or built file — the preset's `no-restricted-imports` ban is the gate.                                    | `pnpm --filter @systemfsoftware/stryker-ignorer-interface lint`  |
| **SI2** | No `effect` or `@effect/*` key in any dependency block of `package.json`.                                                                                | `review` — the reviewer reads the dependency blocks              |
| **SI3** | Types only: no source or built file exports a value, a function, or a class — `dist/index.mjs` stays empty and every export is a type.                   | `pnpm --filter @systemfsoftware/stryker-ignorer-interface build` |
| **SI4** | An ignorer's absence is never a reason: `shouldIgnore` returns a reason string or `undefined`, nothing else.                                             | `review` — the reviewer reads the declared signature             |
| **SI5** | The published surface is exactly what `etc/stryker-ignorer-interface.api.md` lists; the report is regenerated with `pnpm api:update`, never hand-edited. | `pnpm --filter @systemfsoftware/stryker-ignorer-interface build` |
| **SI6** | No test suite ships here: the package has no behaviour to pin, so the API report and the type-checker are its verification.                              | `pnpm --filter @systemfsoftware/stryker-ignorer-interface test`  |

The reviewer's decision on each `review`-gated row, shown as `wrong:`/`right:`:

- **SI2** — `wrong:` `"effect": "catalog:"` in `dependencies` or anywhere under `devDependencies`; `right:` an empty `dependencies` and a `devDependencies` block holding only build tooling.
- **SI4** — `wrong:` `shouldIgnore(node: Node, ancestors: readonly Node[]): boolean | string`; `right:` `shouldIgnore(node: Node, ancestors: readonly Node[]): string | undefined`.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-ignorer-interface build
pnpm --filter @systemfsoftware/stryker-ignorer-interface typecheck
pnpm --filter @systemfsoftware/stryker-ignorer-interface test
pnpm --filter @systemfsoftware/stryker-ignorer-interface lint
pnpm --filter @systemfsoftware/stryker-ignorer-interface attw
```
