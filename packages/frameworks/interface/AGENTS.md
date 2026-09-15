# AGENTS.md — `@systemfsoftware/stryker-framework-interface`

The framework interface as types only: the claim record a plugin declares
(`formatId`, `extensions`, `language`, `contractVersion`), the embedded document
and script-region shapes it produces, the `FrameworkContext` toolkit the core
hands its hooks, and the AST vocabulary re-exported from
`@systemfsoftware/stryker-ignorer-interface` and bundled into this package's own
declarations.

The package is the tier both sides depend on: a framework plugin types its claim
and hook argument against it, the instrumenter constructs the context value at
hook invocation, and neither the language nor the engine owns it. It publishes
no value, no function, and no schema. Zero runtime dependencies beyond the
vocabulary tier and zero Effect is the package's identity — nothing that imports
effect or a host package, at run time or in `devDependencies`, may land here.
Root `AGENTS.md` governs.

## Rules

| ID       | Rule                                                                                                                                                                                                                       | Gate                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **SFI1** | No `effect` or `@effect/*` import in any source or built file — the preset's `no-restricted-imports` ban is the gate.                                                                                                      | `pnpm --filter @systemfsoftware/stryker-framework-interface lint`  |
| **SFI2** | No `effect` or `@effect/*` key in any dependency block of `package.json`.                                                                                                                                                  | `review` — the reviewer reads the dependency blocks                |
| **SFI3** | Types only: no source or built file exports a value, a function, or a class — `dist/index.mjs` stays empty and every export is a type.                                                                                     | `pnpm --filter @systemfsoftware/stryker-framework-interface build` |
| **SFI4** | The AST vocabulary is re-exported (`export type *`), never re-derived, and `@systemfsoftware/stryker-ignorer-interface` sits in `dependencies` so the emitted declaration keeps one physical copy of the recursive `Node`. | `pnpm --filter @systemfsoftware/stryker-framework-interface build` |
| **SFI5** | The published surface is exactly what `etc/stryker-framework-interface.api.md` lists; the report is regenerated with `pnpm api:update`, never hand-edited.                                                                 | `pnpm --filter @systemfsoftware/stryker-framework-interface build` |
| **SFI6** | No test suite ships here: the package has no behaviour to pin, so the API report and the type-checker are its verification.                                                                                                | `pnpm --filter @systemfsoftware/stryker-framework-interface test`  |
| **SFI7** | No import of a framework plugin, an engine, the instrumenter, or any `@systemfsoftware/stryker-js-*` package — this tier is what both sides depend on.                                                                     | `pnpm --filter @systemfsoftware/stryker-framework-interface lint`  |

The reviewer's decision on the `review`-gated row, shown as `wrong:`/`right:`:

- **SFI2** — `wrong:` `"effect": "catalog:"` in `dependencies` or anywhere under `devDependencies`; `right:` a `dependencies` block holding only the vocabulary tier and a `devDependencies` block holding only build tooling.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-framework-interface build
pnpm --filter @systemfsoftware/stryker-framework-interface typecheck
pnpm --filter @systemfsoftware/stryker-framework-interface test
pnpm --filter @systemfsoftware/stryker-framework-interface lint
pnpm --filter @systemfsoftware/stryker-framework-interface attw
```
